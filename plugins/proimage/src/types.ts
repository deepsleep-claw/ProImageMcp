export type AdapterName = "openrouter-images" | "openai-images" | "gemini-native";
export type Capability = "text_to_image" | "image_to_image" | "mask" | "transparent";

export interface Preset {
  id: string;
  displayName: string;
  adapter: AdapterName;
  apiKey: string;
  baseUrl: string;
  model: string;
  capabilities: Capability[];
  description: string;
  options: Record<string, unknown>;
  timeoutMs: number;
}

export interface AppConfig {
  presets: Map<string, Preset>;
  defaultPreset?: string;
  outputDir: string;
  timeoutMs: number;
  connectTimeoutMs: number;
  maxInputBytes: number;
  maxTotalInputBytes: number;
  maxOutputBytes: number;
  logRetentionDays: number;
}

export interface ConfigStatus {
  configPath: string;
  examplePath: string;
  state: "ready" | "missing" | "invalid";
  reloadError?: string;
  loadedAt?: string;
}

export interface CommonImageArgs {
  prompt: string;
  preset?: string;
  background?: "auto" | "transparent" | "opaque";
  size?: string;
  aspect_ratio?: string;
  quality?: "auto" | "low" | "medium" | "high";
  output_format?: "png" | "jpeg" | "webp";
  output_compression?: number;
  seed?: number;
  adapter_options?: Record<string, unknown>;
}

export interface EditArgs extends CommonImageArgs {
  images: string[];
  mask?: string;
}

export interface LoadedImage {
  path: string;
  bytes: Buffer;
  mime: string;
}

export interface AdapterRequest {
  preset: Preset;
  prompt: string;
  parameters: Record<string, unknown>;
  images: LoadedImage[];
  mask?: LoadedImage;
  maxOutputBytes: number;
  connectTimeoutMs: number;
}

export interface ProviderResult {
  bytes: Buffer;
  declaredMime?: string;
  request: Record<string, unknown>;
  requestId?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface SavedResult {
  path: string;
  metadataPath?: string;
  metadataWriteError?: string;
  mimeType: string;
  byteLength: number;
}
