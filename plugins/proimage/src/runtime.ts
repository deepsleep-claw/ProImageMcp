import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { lookup as systemLookup } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { EnvHttpProxyAgent, fetch, FormData } from "undici";
import { ProImageError } from "./errors.js";
import { sanitize } from "./sanitize.js";
import type { AppConfig, LoadedImage, ProviderResult, SavedResult } from "./types.js";

export interface DetectedImage {
  mime: string;
  extension: string;
}

export function detectImage(bytes: Buffer): DetectedImage | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", extension: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", extension: "jpg" };
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", extension: "webp" };
  }
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) {
    return { mime: "image/gif", extension: "gif" };
  }
  const beginning = bytes.subarray(0, 1024).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(beginning)) return { mime: "image/svg+xml", extension: "svg" };
  return undefined;
}

export async function loadImages(
  paths: string[],
  maxInputBytes: number,
  maxTotalInputBytes: number,
): Promise<LoadedImage[]> {
  const loaded: LoadedImage[] = [];
  let total = 0;
  for (const inputPath of paths) {
    if (!path.isAbsolute(inputPath)) {
      throw new ProImageError("input_error", `输入图片必须使用绝对路径: ${inputPath}`, false, { path: inputPath });
    }
    let info;
    try {
      info = await stat(inputPath);
    } catch (error) {
      throw new ProImageError("input_error", `无法读取输入图片: ${inputPath}`, false, {
        path: inputPath,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    if (!info.isFile()) throw new ProImageError("input_error", `输入路径不是文件: ${inputPath}`, false, { path: inputPath });
    if (info.size > maxInputBytes) {
      throw new ProImageError("input_error", `单个输入图片超过限制 (${maxInputBytes} bytes): ${inputPath}`, false, { path: inputPath, bytes: info.size });
    }
    total += info.size;
    if (total > maxTotalInputBytes) {
      throw new ProImageError("input_error", `输入图片总大小超过限制 (${maxTotalInputBytes} bytes)。`, false, { totalBytes: total });
    }
    const bytes = await readFile(inputPath);
    const detected = detectImage(bytes);
    if (!detected) throw new ProImageError("input_error", `无法识别输入图片格式: ${inputPath}`, false, { path: inputPath });
    loaded.push({ path: path.resolve(inputPath), bytes, mime: detected.mime });
  }
  return loaded;
}

function localDateParts(now = new Date()): { date: string; timestamp: string } {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timestamp = `${date}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${String(now.getMilliseconds()).padStart(3, "0")}`;
  return { date, timestamp };
}

export async function saveResult(
  config: AppConfig,
  presetId: string,
  result: ProviderResult,
  metadata: Record<string, unknown>,
): Promise<SavedResult> {
  if (result.bytes.byteLength > config.maxOutputBytes) {
    throw new ProImageError("output_error", `生成图片超过输出限制 (${config.maxOutputBytes} bytes)。`, false, { bytes: result.bytes.byteLength });
  }
  const detected = detectImage(result.bytes);
  if (!detected) {
    throw new ProImageError("output_error", "服务返回了内容，但无法从文件头识别图片格式。", false, {
      declaredMime: result.declaredMime,
      bytes: result.bytes.byteLength,
    });
  }
  const { date, timestamp } = localDateParts();
  const dayDir = path.join(config.outputDir, date);
  await mkdir(dayDir, { recursive: true, mode: 0o700 });
  const safePreset = presetId.replace(/[^A-Za-z0-9_-]+/g, "_");
  const stem = `${timestamp}_${safePreset}_${randomBytes(4).toString("hex")}`;
  const outputPath = path.join(dayDir, `${stem}.${detected.extension}`);
  const metadataPath = path.join(dayDir, `${stem}.json`);
  await writeFile(outputPath, result.bytes, { flag: "wx", mode: 0o600 });
  try {
    await writeFile(metadataPath, `${JSON.stringify(sanitize({
      ...metadata,
      output: {
        path: outputPath,
        mimeType: detected.mime,
        declaredMime: result.declaredMime,
        byteLength: result.bytes.byteLength,
        alphaCheck: "not_performed",
      },
    }), null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    return {
      path: outputPath,
      mimeType: detected.mime,
      byteLength: result.bytes.byteLength,
      metadataWriteError: error instanceof Error ? error.message : String(error),
    };
  }
  return { path: outputPath, metadataPath, mimeType: detected.mime, byteLength: result.bytes.byteLength };
}

export class FileLogger {
  readonly directory = path.join(os.tmpdir(), "proimage-mcp", "logs");
  private retentionDays = 30;
  private cleanedForDate?: string;

  setRetentionDays(days: number): void {
    this.retentionDays = days;
  }

  async write(event: string, data: Record<string, unknown>): Promise<void> {
    const { date } = localDateParts();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (this.cleanedForDate !== date) {
      this.cleanedForDate = date;
      await this.cleanup().catch(() => undefined);
    }
    const line = JSON.stringify(sanitize({ time: new Date().toISOString(), event, ...data }));
    await writeFile(path.join(this.directory, `${date}.jsonl`), `${line}\n`, { encoding: "utf8", flag: "a", mode: 0o600 });
  }

  private async cleanup(): Promise<void> {
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    for (const entry of await readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name)) continue;
      const filePath = path.join(this.directory, entry.name);
      const info = await stat(filePath);
      if (info.mtimeMs < cutoff) await unlink(filePath).catch(() => undefined);
    }
  }
}

async function readLimited(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new ProImageError("output_error", `响应超过限制 (${limit} bytes)。`, false, { contentLength: declared });
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ProImageError("output_error", `响应超过限制 (${limit} bytes)。`, false, { bytesRead: size });
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

export function isPublicDownloadAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2) || a === 192 && b === 88 && c === 99) return false;
    if (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family !== 6 || address.includes("%")) return false;
  const [first = 0, second = 0] = address.split(":").slice(0, 2).map((part) => parseInt(part || "0", 16));
  // Only global unicast is accepted; transition and special-purpose ranges are excluded.
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3fff
    && !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8));
}

async function publicDownloadLookup(hostname: string, timeoutMs: number): Promise<LookupFunction> {
  hostname = hostname.replace(/^\[|\]$/g, "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    isIP(hostname) ? Promise.resolve([{ address: hostname, family: isIP(hostname) }]) : lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ProImageError("timeout", "图片下载地址解析超时。", true)), timeoutMs); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
  if (addresses.length === 0 || addresses.some((item) => !isPublicDownloadAddress(item.address))) {
    throw new ProImageError("output_error", "图片下载地址必须解析到公网地址。", false);
  }
  return (host, options, callback) => {
    if (host.replace(/^\[|\]$/g, "").toLowerCase() !== hostname.toLowerCase()) {
      // Proxy hosts remain under the user's proxy configuration.
      systemLookup(host, options, callback);
      return;
    }
    const candidates = options.family ? addresses.filter((item) => item.family === options.family) : addresses;
    const first = candidates[0];
    if (!first) { callback(new Error("No public address for the requested family"), []); return; }
    if (options.all) callback(null, candidates);
    else callback(null, first.address, first.family);
  };
}

export class HttpClient {
  async postJson(
    url: string,
    apiKey: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    connectTimeoutMs: number,
    maxResponseBytes: number,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ json: unknown; requestId?: string }> {
    const headers: Record<string, string> = { "content-type": "application/json", ...extraHeaders };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    return this.requestJson(url, { method: "POST", headers, body: JSON.stringify(body) }, body, timeoutMs, connectTimeoutMs, maxResponseBytes);
  }

  async postForm(
    url: string,
    apiKey: string,
    form: FormData,
    safeBody: Record<string, unknown>,
    timeoutMs: number,
    connectTimeoutMs: number,
    maxResponseBytes: number,
  ): Promise<{ json: unknown; requestId?: string }> {
    return this.requestJson(url, { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form }, safeBody, timeoutMs, connectTimeoutMs, maxResponseBytes);
  }

  async download(url: string, timeoutMs: number, connectTimeoutMs: number, maxBytes: number): Promise<{ bytes: Buffer; mime?: string }> {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new ProImageError("output_error", "图片下载地址无效。", false); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new ProImageError("output_error", "图片下载地址必须使用 HTTPS 且不能包含用户凭据。", false);
    }
    const downloadLookup = await publicDownloadLookup(parsed.hostname, connectTimeoutMs);
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const dispatcher = new EnvHttpProxyAgent({ connect: { timeout: connectTimeoutMs, lookup: downloadLookup }, headersTimeout: 0, bodyTimeout: 0 });
      try {
        const response = await fetch(url, { dispatcher, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new ProImageError("provider_error", `图片下载失败: HTTP ${response.status}`, response.status >= 500 || response.status === 429, { status: response.status, url });
        return { bytes: await readLimited(response as unknown as Response, maxBytes), mime: response.headers.get("content-type") ?? undefined };
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      } finally {
        await dispatcher.close();
      }
    }
    if (lastError instanceof ProImageError) throw lastError;
    throw new ProImageError("network", "生成成功，但下载结果图片失败。", true, { url, cause: lastError instanceof Error ? lastError.message : String(lastError) });
  }

  private async requestJson(
    url: string,
    init: { method: string; headers: Record<string, string>; body: string | FormData },
    safeBody: Record<string, unknown>,
    timeoutMs: number,
    connectTimeoutMs: number,
    maxResponseBytes: number,
  ): Promise<{ json: unknown; requestId?: string }> {
    const dispatcher = new EnvHttpProxyAgent({ connect: { timeout: connectTimeoutMs }, headersTimeout: 0, bodyTimeout: 0 });
    try {
      const response = await fetch(url, { ...init, dispatcher, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
      const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined;
      const bytes = await readLimited(response as unknown as Response, maxResponseBytes);
      const text = bytes.toString("utf8");
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        throw new ProImageError("provider_error", "图片服务返回了非 JSON 响应。", response.status >= 500, {
          status: response.status,
          requestId,
          request: { url, body: safeBody },
        });
      }
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
        throw new ProImageError(response.status >= 400 && response.status < 500 ? "provider_rejected" : "provider_error", `图片服务拒绝请求: HTTP ${response.status}`, retryable, {
          status: response.status,
          requestId,
          providerError: json,
          request: { url, body: safeBody },
        });
      }
      return { json, requestId };
    } catch (error) {
      if (error instanceof ProImageError) throw error;
      if (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name)) {
        throw new ProImageError("timeout", "图片服务请求超时。", true, { request: { url, body: safeBody } });
      }
      throw new ProImageError("network", "无法连接图片服务。", true, {
        cause: error instanceof Error ? error.message : String(error),
        request: { url, body: safeBody },
      });
    } finally {
      await dispatcher.close();
    }
  }
}

export function asDataUrl(image: LoadedImage): string {
  return `data:${image.mime};base64,${image.bytes.toString("base64")}`;
}

export function asFormData(): FormData {
  return new FormData();
}
