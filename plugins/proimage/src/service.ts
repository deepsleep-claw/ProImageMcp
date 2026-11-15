import { isDeepStrictEqual } from "node:util";
import { AdapterRegistry } from "./adapters.js";
import { ConfigManager } from "./config.js";
import { imageCost, type ImageCost } from "./cost.js";
import { errorPayload, ProImageError } from "./errors.js";
import { FileLogger, loadImages, saveResult } from "./runtime.js";
import { sanitize } from "./sanitize.js";
import type { AppConfig, CommonImageArgs, EditArgs, Preset } from "./types.js";

const DIRECT_PARAMETER_KEYS = [
  "background",
  "size",
  "aspect_ratio",
  "quality",
  "output_format",
  "output_compression",
  "seed",
] as const;

export interface ToolResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export class ProImageService {
  constructor(
    readonly configManager = new ConfigManager(),
    private readonly adapters = new AdapterRegistry(),
    private readonly logger = new FileLogger(),
  ) {}

  async initialize(): Promise<void> {
    await this.configManager.initialize();
  }

  async getPresets(): Promise<ToolResponse> {
    let config: AppConfig | undefined;
    let configError: unknown;
    try {
      config = await this.configManager.getConfig();
      this.logger.setRetentionDays(config.logRetentionDays);
    } catch (error) {
      configError = error;
    }
    const status = this.configManager.status;
    const presets = config ? [...config.presets.values()].map((preset) => ({
      id: preset.id,
      displayName: preset.displayName,
      adapter: preset.adapter,
      model: preset.model,
      capabilities: preset.capabilities,
      description: preset.description,
      isDefault: config?.defaultPreset === preset.id,
    })) : [];
    const payload: Record<string, unknown> = {
      ok: Boolean(config),
      presets,
      defaultPreset: config?.defaultPreset,
      config: status,
      note: config
        ? "预设来自热重载配置；响应不会暴露密钥、Base URL 或端口。"
        : `配置尚不可用。请复制 ${status.examplePath} 为 ${status.configPath} 并填写密钥。`,
    };
    if (configError) payload.error = errorPayload(configError);
    return this.response(payload);
  }

  async generate(args: CommonImageArgs): Promise<ToolResponse> {
    return this.run(args, []);
  }

  async edit(args: EditArgs): Promise<ToolResponse> {
    return this.run(args, args.images, args.mask);
  }

  private async run(args: CommonImageArgs | EditArgs, imagePaths: string[], maskPath?: string): Promise<ToolResponse> {
    const startedAt = new Date().toISOString();
    let cost: ImageCost | undefined;
    try {
      const config = await this.configManager.getConfig();
      this.logger.setRetentionDays(config.logRetentionDays);
      const preset = this.resolvePreset(config, args.preset);
      this.validateCapabilities(preset, args, imagePaths.length > 0, Boolean(maskPath));
      const parameters = this.parameters(preset, args);
      const allImages = await loadImages(maskPath ? [...imagePaths, maskPath] : imagePaths, config.maxInputBytes, config.maxTotalInputBytes);
      const mask = maskPath ? allImages.pop() : undefined;
      await this.logger.write("generation_started", sanitize({
        startedAt,
        preset: preset.id,
        adapter: preset.adapter,
        model: preset.model,
        arguments: args,
        normalizedParameters: parameters,
        references: imagePaths.map((item) => ({ path: item })),
        mask: maskPath,
      }, this.configManager.secrets) as Record<string, unknown>).catch(() => undefined);
      const providerResult = await this.adapters.execute({
        preset,
        prompt: args.prompt,
        parameters,
        images: allImages,
        mask,
        maxOutputBytes: config.maxOutputBytes,
        connectTimeoutMs: config.connectTimeoutMs,
      });
      cost = imageCost(preset.adapter, providerResult, parameters.output_format);
      const saved = await saveResult(config, preset.id, providerResult, sanitize({
        createdAt: new Date().toISOString(),
        prompt: args.prompt,
        references: imagePaths.map((item) => ({ path: item })),
        mask: maskPath ? { path: maskPath } : undefined,
        normalizedArguments: { ...args, adapter_options: parameters },
        cost,
        provider: {
          preset: preset.id,
          adapter: preset.adapter,
          model: providerResult.model ?? preset.model,
          requestId: providerResult.requestId,
          request: providerResult.request,
          resultMetadata: providerResult.metadata,
        },
      }, this.configManager.secrets) as Record<string, unknown>);
      const payload: Record<string, unknown> = {
        ok: true,
        generated: true,
        path: saved.path,
        metadataPath: saved.metadataPath,
        metadataWriteError: saved.metadataWriteError,
        mimeType: saved.mimeType,
        byteLength: saved.byteLength,
        alphaCheck: "not_performed",
        preset: preset.id,
        adapter: preset.adapter,
        model: providerResult.model ?? preset.model,
        cost,
        requestId: providerResult.requestId,
        providerMetadata: sanitize(providerResult.metadata),
      };
      await this.logger.write("generation_succeeded", sanitize({ startedAt, result: payload, providerRequest: providerResult.request }, this.configManager.secrets) as Record<string, unknown>).catch(() => undefined);
      return this.response(payload);
    } catch (error) {
      const payload = errorPayload(error, args);
      if (cost) payload.cost = cost;
      await this.logger.write("generation_failed", sanitize({ startedAt, error: payload }, this.configManager.secrets) as Record<string, unknown>).catch(() => undefined);
      return this.response(payload, true);
    }
  }

  private resolvePreset(config: AppConfig, requested?: string): Preset {
    const id = requested || config.defaultPreset;
    if (!id) {
      throw new ProImageError("preset_not_found", "没有传入 preset，且未配置默认预设。请先调用 proimage_get_presets。", false);
    }
    const preset = config.presets.get(id);
    if (!preset) throw new ProImageError("preset_not_found", `预设不存在: ${id}。请调用 proimage_get_presets 获取当前配置。`, false, { preset: id });
    return preset;
  }

  private validateCapabilities(preset: Preset, args: CommonImageArgs, isEdit: boolean, hasMask: boolean): void {
    const needed = isEdit ? "image_to_image" : "text_to_image";
    if (!preset.capabilities.includes(needed)) {
      throw new ProImageError("unsupported_capability", `预设 ${preset.id} 不支持 ${needed}。`, false, { preset: preset.id, capability: needed });
    }
    if (hasMask && !preset.capabilities.includes("mask")) {
      throw new ProImageError("unsupported_capability", `预设 ${preset.id} 不支持 mask。`, false, { preset: preset.id, capability: "mask" });
    }
    if (hasMask && preset.adapter !== "openai-images") {
      throw new ProImageError("unsupported_capability", `适配器 ${preset.adapter} 没有实现 mask 传输。`, false, {
        preset: preset.id,
        adapter: preset.adapter,
        capability: "mask",
      });
    }
    if (args.background === "transparent" && !preset.capabilities.includes("transparent")) {
      throw new ProImageError("unsupported_capability", `预设 ${preset.id} 未声明 transparent 能力。`, false, { preset: preset.id, capability: "transparent" });
    }
    if (args.background === "transparent" && args.output_format === "jpeg") {
      throw new ProImageError("invalid_arguments", "透明背景不能使用 jpeg 输出，请选择 png 或 webp。", false);
    }
  }

  private parameters(preset: Preset, args: CommonImageArgs): Record<string, unknown> {
    const direct: Record<string, unknown> = {};
    for (const key of DIRECT_PARAMETER_KEYS) {
      if (args[key] !== undefined) direct[key] = args[key];
    }
    const adapterOptions = args.adapter_options ?? {};
    for (const [key, value] of Object.entries(adapterOptions)) {
      if (direct[key] !== undefined && !isDeepStrictEqual(direct[key], value)) {
        throw new ProImageError("invalid_arguments", `参数 ${key} 同时出现在通用参数与 adapter_options，且值不同。`, false, {
          key,
          commonValue: direct[key],
          adapterValue: value,
        });
      }
    }
    const merged = { ...preset.options, ...adapterOptions, ...direct };
    for (const key of ["model", "prompt", "input_references", "image", "image[]", "mask", "contents"]) {
      if (key in merged) throw new ProImageError("invalid_arguments", `参数 ${key} 由适配器管理。`, false);
    }
    if ("n" in merged && merged.n !== 1) throw new ProImageError("invalid_arguments", "ProImage 每次工具调用只允许生成一张图片，n 必须为 1。", false, { n: merged.n });
    if (merged.stream === true) throw new ProImageError("invalid_arguments", "轻量版 ProImage 不支持流式图片响应。", false);
    delete merged.n;
    delete merged.stream;
    return merged;
  }

  private response(payload: Record<string, unknown>, isError = false): ToolResponse {
    payload = sanitize(payload, this.configManager.secrets) as Record<string, unknown>;
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
      ...(isError ? { isError: true } : {}),
    };
  }
}
