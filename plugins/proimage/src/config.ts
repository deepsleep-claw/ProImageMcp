import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { watchFile, unwatchFile } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { ProImageError } from "./errors.js";
import type { AdapterName, AppConfig, Capability, ConfigStatus, Preset } from "./types.js";

const ADAPTERS = new Set<AdapterName>(["openrouter-images", "openai-images", "gemini-native"]);
const CAPABILITIES = new Set<Capability>(["text_to_image", "image_to_image", "mask", "transparent"]);

function defaultConfigDir(): string {
  return path.join(os.homedir(), ".proimage-mcp");
}

export function resolveConfigPath(): string {
  const overridden = process.env.PROIMAGE_CONFIG_PATH;
  if (overridden) {
    if (!path.isAbsolute(overridden)) throw new ProImageError("config_invalid", "PROIMAGE_CONFIG_PATH 必须是绝对路径。", false);
    return path.resolve(overridden);
  }
  return path.join(defaultConfigDir(), "proimage.env");
}

export function defaultOutputDir(): string {
  return path.join(os.homedir(), "Pictures", "ProImage");
}

type EnvValues = Record<string, string | undefined>;

function positiveInt(env: EnvValues, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} 必须是正整数`);
  return value;
}

function required(env: EnvValues, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`缺少 ${key}`);
  return value;
}

function parsePreset(env: EnvValues, id: string, globalTimeoutMs: number): Preset {
  if (!/^[A-Z0-9_]+$/.test(id)) throw new Error(`预设名 ${id} 只能包含大写字母、数字和下划线`);
  const prefix = `PROIMAGE_PRESET_${id}_`;
  const adapter = required(env, `${prefix}ADAPTER`) as AdapterName;
  if (!ADAPTERS.has(adapter)) throw new Error(`${prefix}ADAPTER 不受支持: ${adapter}`);
  const capabilities = (env[`${prefix}CAPABILITIES`] ?? "text_to_image")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as Capability[];
  for (const capability of capabilities) {
    if (!CAPABILITIES.has(capability)) throw new Error(`${prefix}CAPABILITIES 不受支持: ${capability}`);
  }
  let options: Record<string, unknown> = {};
  const rawOptions = env[`${prefix}OPTIONS_JSON`];
  if (rawOptions) {
    let parsed: unknown;
    try { parsed = JSON.parse(rawOptions); } catch { throw new Error(`${prefix}OPTIONS_JSON 必须是有效 JSON 对象`); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${prefix}OPTIONS_JSON 必须是 JSON 对象`);
    options = parsed as Record<string, unknown>;
  }
  const defaults: Record<AdapterName, string> = {
    "openrouter-images": "https://openrouter.ai/api/v1/images",
    "openai-images": "https://api.openai.com/v1/images",
    "gemini-native": "https://generativelanguage.googleapis.com/v1beta/models",
  };
  return {
    id,
    displayName: env[`${prefix}DISPLAY_NAME`]?.trim() || id,
    adapter,
    apiKey: required(env, `${prefix}API_KEY`),
    baseUrl: env[`${prefix}BASE_URL`]?.trim() || defaults[adapter],
    model: required(env, `${prefix}MODEL`),
    capabilities: [...new Set(capabilities)],
    description: env[`${prefix}DESCRIPTION`]?.trim() || "",
    options,
    timeoutMs: positiveInt(env, `${prefix}TIMEOUT_MS`, globalTimeoutMs),
  };
}

export function parseConfigText(text: string): AppConfig {
  const env = parseEnv(text);
  const timeoutMs = positiveInt(env, "PROIMAGE_TIMEOUT_MS", 15 * 60 * 1000);
  const ids = (env.PROIMAGE_PRESETS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error("PROIMAGE_PRESETS 至少需要一个预设");
  const presets = new Map<string, Preset>();
  for (const id of ids) {
    if (presets.has(id)) throw new Error(`重复预设: ${id}`);
    presets.set(id, parsePreset(env, id, timeoutMs));
  }
  const defaultPreset = env.PROIMAGE_DEFAULT_PRESET?.trim() || undefined;
  if (defaultPreset && !presets.has(defaultPreset)) throw new Error(`默认预设不存在: ${defaultPreset}`);
  const outputDir = env.PROIMAGE_OUTPUT_DIR?.trim() || defaultOutputDir();
  if (!path.isAbsolute(outputDir)) throw new Error("PROIMAGE_OUTPUT_DIR 必须是绝对路径");
  return {
    presets,
    defaultPreset,
    outputDir: path.resolve(outputDir),
    timeoutMs,
    connectTimeoutMs: positiveInt(env, "PROIMAGE_CONNECT_TIMEOUT_MS", 30_000),
    maxInputBytes: positiveInt(env, "PROIMAGE_MAX_INPUT_BYTES", 50 * 1024 * 1024),
    maxTotalInputBytes: positiveInt(env, "PROIMAGE_MAX_TOTAL_INPUT_BYTES", 200 * 1024 * 1024),
    maxOutputBytes: positiveInt(env, "PROIMAGE_MAX_OUTPUT_BYTES", 100 * 1024 * 1024),
    logRetentionDays: positiveInt(env, "PROIMAGE_LOG_RETENTION_DAYS", 30),
  };
}

const EXAMPLE = `# ProImage configuration. Changes are hot-reloaded.\nPROIMAGE_PRESETS=OPENROUTER_IMAGE2_HIGH\nPROIMAGE_DEFAULT_PRESET=OPENROUTER_IMAGE2_HIGH\n\nPROIMAGE_PRESET_OPENROUTER_IMAGE2_HIGH_DISPLAY_NAME=OpenRouter GPT-Image-2 High\nPROIMAGE_PRESET_OPENROUTER_IMAGE2_HIGH_ADAPTER=openrouter-images\nPROIMAGE_PRESET_OPENROUTER_IMAGE2_HIGH_API_KEY=replace-with-your-openrouter-key\nPROIMAGE_PRESET_OPENROUTER_IMAGE2_HIGH_BASE_URL=https://openrouter.ai/api/v1/images\nPROIMAGE_PRESET_OPENROUTER_IMAGE2_HIGH_MODEL=openai/gpt-image-2\nPROIMAGE_PRESET_OPENROUTER_IMAGE2_HIGH_CAPABILITIES=text_to_image,image_to_image,transparent\nPROIMAGE_PRESET_OPENROUTER_IMAGE2_HIGH_DESCRIPTION=OpenRouter GPT-Image-2 high；transparent 参数会原样传递。\nPROIMAGE_PRESET_OPENROUTER_IMAGE2_HIGH_OPTIONS_JSON={"quality":"high","output_format":"png"}\n`;

export class ConfigManager {
  readonly configPath: string;
  readonly examplePath: string;
  private snapshot?: AppConfig;
  private readonly secretValues = new Set<string>();

  get secrets(): string[] { return [...this.secretValues]; }
  private signature?: string;
  private statusValue: ConfigStatus;
  private reloadQueued = false;

  constructor(configPath = resolveConfigPath()) {
    this.configPath = path.resolve(configPath);
    this.examplePath = `${this.configPath}.example`;
    this.statusValue = { configPath: this.configPath, examplePath: this.examplePath, state: "missing" };
  }

  async initialize(): Promise<void> {
    await mkdir(path.dirname(this.configPath), { recursive: true, mode: 0o700 });
    try {
      await stat(this.examplePath);
    } catch {
      await writeFile(this.examplePath, EXAMPLE, { encoding: "utf8", flag: "wx", mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    }
    await this.reloadIfChanged(true);
    watchFile(this.configPath, { interval: 1_000, persistent: false }, () => {
      if (this.reloadQueued) return;
      this.reloadQueued = true;
      setTimeout(() => {
        this.reloadQueued = false;
        void this.reloadIfChanged(true);
      }, 150).unref();
    });
  }

  close(): void {
    unwatchFile(this.configPath);
  }

  get status(): ConfigStatus {
    return { ...this.statusValue };
  }

  async getConfig(): Promise<AppConfig> {
    await this.reloadIfChanged(false);
    if (!this.snapshot) {
      const type = this.statusValue.state === "missing" ? "config_missing" : "config_invalid";
      throw new ProImageError(type, this.statusValue.state === "missing"
        ? `配置不存在。请复制并编辑 ${this.examplePath}，保存为 ${this.configPath}`
        : `配置无效：${this.statusValue.reloadError ?? "未知错误"}`, false, { ...this.status });
    }
    return this.snapshot;
  }

  async reloadIfChanged(force: boolean): Promise<void> {
    let nextSignature: string;
    try {
      const info = await stat(this.configPath);
      nextSignature = `${info.mtimeMs}:${info.size}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.statusValue = {
          configPath: this.configPath,
          examplePath: this.examplePath,
          state: "missing",
          reloadError: this.snapshot ? "配置文件已删除；继续使用最后一次有效配置。" : undefined,
          loadedAt: this.statusValue.loadedAt,
        };
        return;
      }
      throw error;
    }
    if (!force && nextSignature === this.signature) return;
    try {
      const text = await readFile(this.configPath, "utf8");
      for (const [key, value] of Object.entries(parseEnv(text))) {
        if (key.endsWith("_API_KEY") && value?.trim()) this.secretValues.add(value.trim());
      }
      const parsed = parseConfigText(text);
      this.snapshot = parsed;
      this.signature = nextSignature;
      this.statusValue = {
        configPath: this.configPath,
        examplePath: this.examplePath,
        state: "ready",
        loadedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.signature = nextSignature;
      this.statusValue = {
        configPath: this.configPath,
        examplePath: this.examplePath,
        state: "invalid",
        reloadError: "配置格式无效，请检查配置字段、预设和 JSON 参数。",
        loadedAt: this.statusValue.loadedAt,
      };
    }
  }
}
