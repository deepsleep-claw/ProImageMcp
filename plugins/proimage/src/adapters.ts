import path from "node:path";
import { Blob } from "node:buffer";
import { ProImageError } from "./errors.js";
import { asDataUrl, asFormData, HttpClient } from "./runtime.js";
import type { AdapterName, AdapterRequest, ProviderResult } from "./types.js";

interface ImageResponseItem {
  b64_json?: string;
  url?: string;
  media_type?: string;
  revised_prompt?: string;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function decodeImageResponse(
  response: unknown,
  request: AdapterRequest,
  http: HttpClient,
  providerRequest: Record<string, unknown>,
  requestId?: string,
): Promise<ProviderResult> {
  const body = objectValue(response);
  const data = Array.isArray(body.data) ? body.data : [];
  const item = objectValue(data[0]) as ImageResponseItem;
  const requestedModel = objectValue(providerRequest.body).model;
  const model = typeof body.model === "string" ? body.model : typeof requestedModel === "string" ? requestedModel : request.preset.model;
  const metadata = { created: body.created, usage: body.usage, svg_usage: body.svg_usage, revisedPrompt: item.revised_prompt };
  if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
    let bytes: Buffer;
    try {
      bytes = Buffer.from(item.b64_json, "base64");
    } catch {
      throw new ProImageError("output_error", "图片服务返回了无效的 base64 图片。", false, { requestId });
    }
    if (bytes.byteLength > request.maxOutputBytes) throw new ProImageError("output_error", "生成图片超过输出大小限制。", false, { bytes: bytes.byteLength, requestId });
    return {
      bytes,
      declaredMime: item.media_type,
      request: providerRequest,
      requestId,
      model,
      metadata,
    };
  }
  if (typeof item.url === "string" && item.url.length > 0) {
    const downloaded = await http.download(item.url, request.preset.timeoutMs, request.connectTimeoutMs, request.maxOutputBytes);
    return {
      bytes: downloaded.bytes,
      declaredMime: downloaded.mime,
      request: providerRequest,
      requestId,
      model,
      metadata: { ...metadata, resultUrl: item.url },
    };
  }
  throw new ProImageError("output_error", "图片服务成功响应中没有图片数据。", false, { requestId, response: body, request: providerRequest });
}

function endpoint(baseUrl: string, suffix: "generations" | "edits"): string {
  const clean = baseUrl.replace(/\/+$/, "");
  if (clean.endsWith(`/${suffix}`)) return clean;
  if (clean.endsWith("/images")) return `${clean}/${suffix}`;
  return `${clean}/images/${suffix}`;
}

export class AdapterRegistry {
  constructor(private readonly http = new HttpClient()) {}

  async execute(request: AdapterRequest): Promise<ProviderResult> {
    const adapters: Record<AdapterName, (value: AdapterRequest) => Promise<ProviderResult>> = {
      "openrouter-images": (value) => this.openRouter(value),
      "openai-images": (value) => this.openAI(value),
      "gemini-native": (value) => this.gemini(value),
    };
    return adapters[request.preset.adapter](request);
  }

  private async openRouter(request: AdapterRequest): Promise<ProviderResult> {
    const body: Record<string, unknown> = {
      model: request.preset.model,
      prompt: request.prompt,
      ...request.parameters,
      n: 1,
    };
    if (request.images.length > 0) {
      body.input_references = request.images.map((image) => ({ type: "image_url", image_url: { url: asDataUrl(image) } }));
    }
    const response = await this.http.postJson(request.preset.baseUrl, request.preset.apiKey, body, request.preset.timeoutMs, request.connectTimeoutMs, request.maxOutputBytes * 2 + 10 * 1024 * 1024);
    return decodeImageResponse(response.json, request, this.http, { url: request.preset.baseUrl, body }, response.requestId);
  }

  private async openAI(request: AdapterRequest): Promise<ProviderResult> {
    if (request.images.length === 0) {
      const url = endpoint(request.preset.baseUrl, "generations");
      const body: Record<string, unknown> = { model: request.preset.model, prompt: request.prompt, ...request.parameters, n: 1 };
      const response = await this.http.postJson(url, request.preset.apiKey, body, request.preset.timeoutMs, request.connectTimeoutMs, request.maxOutputBytes * 2 + 10 * 1024 * 1024);
      return decodeImageResponse(response.json, request, this.http, { url, body }, response.requestId);
    }
    const url = endpoint(request.preset.baseUrl, "edits");
    const form = asFormData();
    form.set("model", request.preset.model);
    form.set("prompt", request.prompt);
    form.set("n", "1");
    const safeFields: Record<string, unknown> = { model: request.preset.model, prompt: request.prompt, n: 1 };
    for (const [key, value] of Object.entries(request.parameters)) {
      if (value === undefined) continue;
      form.set(key, typeof value === "string" ? value : JSON.stringify(value));
      safeFields[key] = value;
    }
    for (const image of request.images) {
      form.append("image[]", new Blob([image.bytes], { type: image.mime }), path.basename(image.path));
    }
    if (request.mask) form.set("mask", new Blob([request.mask.bytes], { type: request.mask.mime }), path.basename(request.mask.path));
    const response = await this.http.postForm(url, request.preset.apiKey, form, {
      ...safeFields,
      images: request.images.map((image) => ({ path: image.path, mime: image.mime, bytes: image.bytes.byteLength })),
      mask: request.mask ? { path: request.mask.path, mime: request.mask.mime, bytes: request.mask.bytes.byteLength } : undefined,
    }, request.preset.timeoutMs, request.connectTimeoutMs, request.maxOutputBytes * 2 + 10 * 1024 * 1024);
    return decodeImageResponse(response.json, request, this.http, { url, body: safeFields, multipart: true }, response.requestId);
  }

  private async gemini(request: AdapterRequest): Promise<ProviderResult> {
    const clean = request.preset.baseUrl.replace(/\/+$/, "");
    const modelName = request.preset.model.replace(/^models\//, "");
    const url = `${clean}/${modelName}:generateContent?key=${encodeURIComponent(request.preset.apiKey)}`;
    const parts: Record<string, unknown>[] = [{ text: request.prompt }];
    for (const image of request.images) parts.push({ inlineData: { mimeType: image.mime, data: image.bytes.toString("base64") } });
    const imageConfig: Record<string, unknown> = {};
    const remaining: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(request.parameters)) {
      if (key === "aspect_ratio") imageConfig.aspectRatio = value;
      else if (key === "size") imageConfig.imageSize = value;
      else remaining[key] = value;
    }
    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
        ...remaining,
      },
    };
    const response = await this.http.postJson(url, "", body, request.preset.timeoutMs, request.connectTimeoutMs, request.maxOutputBytes * 2 + 10 * 1024 * 1024, {});
    const root = objectValue(response.json);
    const candidates = Array.isArray(root.candidates) ? root.candidates : [];
    const content = objectValue(objectValue(candidates[0]).content);
    const responseParts = Array.isArray(content.parts) ? content.parts : [];
    for (const rawPart of responseParts) {
      const inline = objectValue(objectValue(rawPart).inlineData);
      const data = typeof inline.data === "string" ? inline.data : undefined;
      if (!data) continue;
      const bytes = Buffer.from(data, "base64");
      if (bytes.byteLength > request.maxOutputBytes) throw new ProImageError("output_error", "生成图片超过输出大小限制。", false, { bytes: bytes.byteLength, requestId: response.requestId });
      return {
        bytes,
        declaredMime: typeof inline.mimeType === "string" ? inline.mimeType : undefined,
        request: { url, body },
        requestId: response.requestId,
        model: request.preset.model,
        metadata: { usageMetadata: root.usageMetadata, finishReason: objectValue(candidates[0]).finishReason },
      };
    }
    throw new ProImageError("output_error", "Gemini 成功响应中没有图片数据。", false, { requestId: response.requestId, response: root, request: { url, body } });
  }
}
