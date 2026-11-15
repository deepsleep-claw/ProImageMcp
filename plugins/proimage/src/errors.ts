import { sanitize } from "./sanitize.js";

export type FailureType =
  | "config_missing"
  | "config_invalid"
  | "preset_not_found"
  | "unsupported_capability"
  | "invalid_arguments"
  | "input_error"
  | "timeout"
  | "network"
  | "provider_rejected"
  | "provider_error"
  | "output_error"
  | "internal_error";

export class ProImageError extends Error {
  constructor(
    public readonly failureType: FailureType,
    message: string,
    public readonly retryable: boolean,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ProImageError";
  }
}

export function normalizeError(error: unknown): ProImageError {
  if (error instanceof ProImageError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new ProImageError("timeout", "图片服务请求超时。", true);
  }
  if (error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("timeout"))) {
    return new ProImageError("timeout", "图片服务请求超时。", true, { cause: error.message });
  }
  if (error instanceof TypeError) {
    return new ProImageError("network", "无法连接图片服务。", true, { cause: error.message });
  }
  return new ProImageError("internal_error", "ProImage 内部错误。", false, {
    cause: error instanceof Error ? error.message : String(error),
  });
}

export function errorPayload(error: unknown, originalArguments?: unknown): Record<string, unknown> {
  const normalized = normalizeError(error);
  return {
    ok: false,
    failureType: normalized.failureType,
    retryable: normalized.retryable,
    message: normalized.message,
    details: sanitize(normalized.details),
    originalArguments: sanitize(originalArguments),
  };
}
