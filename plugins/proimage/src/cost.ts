import type { AdapterName, ProviderResult } from "./types.js";

export interface ImageCost {
  usd: number | null;
  source: "openai_list_price" | "provider_reported" | "unavailable";
}

// Standard Images API rates per million tokens: https://developers.openai.com/api/docs/pricing#image-generation
const IMAGE_2_RATES = { textInput: 5, imageInput: 8, imageOutput: 30 };
const IMAGE_15_RATES = { textInput: 5, imageInput: 8, imageOutput: 32, textOutput: 10 };
const OPENAI_RATES = new Map<string, typeof IMAGE_2_RATES & { textOutput?: number }>([
  ["gpt-image-2.6-sunburst", IMAGE_2_RATES],
  ["gpt-image-2.6-flare", IMAGE_2_RATES],
  ["gpt-image-2.5-sunburst", IMAGE_2_RATES],
  ["gpt-image-2.5-sunburst-2026-09-08", IMAGE_2_RATES],
  ["gpt-image-2.5-flare", IMAGE_2_RATES],
  ["gpt-image-2.5-flare-2026-09-08", IMAGE_2_RATES],
  ["gpt-image-2", IMAGE_2_RATES],
  ["gpt-image-2-2026-04-21", IMAGE_2_RATES],
  ["gpt-image-1.5", IMAGE_15_RATES],
  ["chatgpt-image-latest", IMAGE_15_RATES],
  ["gpt-image-1-mini", { textInput: 2, imageInput: 2.5, imageOutput: 8 }],
]);

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function imageCost(adapter: AdapterName, result: ProviderResult, outputFormat: unknown): ImageCost {
  const unavailable: ImageCost = { usd: null, source: "unavailable" };
  const usage = objectValue(result.metadata?.usage);
  if (adapter === "openrouter-images") {
    const reported = usage?.cost;
    return typeof reported === "number" && Number.isFinite(reported) && reported >= 0
      ? { usd: reported, source: "provider_reported" }
      : unavailable;
  }

  if (adapter !== "openai-images" || !result.model) return unavailable;
  // SVG authoring is billed separately from the reference image in usage.
  if (outputFormat === "svg" || result.metadata?.svg_usage != null) return unavailable;
  const rates = OPENAI_RATES.get(result.model);
  if (!rates || !usage) return unavailable;

  const input = objectValue(usage.input_tokens_details);
  const output = objectValue(usage.output_tokens_details);
  const textInput = tokenCount(input?.text_tokens);
  const imageInput = tokenCount(input?.image_tokens);
  const imageOutput = tokenCount(output ? output.image_tokens : usage.output_tokens);
  const textOutput = output ? tokenCount(output.text_tokens) : 0;
  if (textInput === undefined || imageInput === undefined || imageOutput === undefined || textOutput === undefined) return unavailable;
  if (usage.input_tokens != null && usage.input_tokens !== textInput + imageInput) return unavailable;
  if (usage.output_tokens != null && usage.output_tokens !== textOutput + imageOutput) return unavailable;
  if (textOutput > 0 && rates.textOutput === undefined) return unavailable;

  const usd = (textInput * rates.textInput + imageInput * rates.imageInput
    + imageOutput * rates.imageOutput + textOutput * (rates.textOutput ?? 0)) / 1_000_000;
  return { usd, source: "openai_list_price" };
}
