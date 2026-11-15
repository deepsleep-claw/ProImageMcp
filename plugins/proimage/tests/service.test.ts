import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AdapterRegistry } from "../src/adapters.js";
import { ConfigManager } from "../src/config.js";
import { detectImage } from "../src/runtime.js";
import { sanitize } from "../src/sanitize.js";
import { ProImageService } from "../src/service.js";
import type { AdapterRequest, ProviderResult } from "../src/types.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

class FakeAdapters {
  calls: AdapterRequest[] = [];
  async execute(request: AdapterRequest): Promise<ProviderResult> {
    this.calls.push(request);
    return {
      bytes: PNG,
      declaredMime: "image/png",
      request: { url: "https://example.invalid/images", body: { prompt: request.prompt, image: "data:image/png;base64,AAAA" } },
      requestId: "request-test",
      model: request.preset.model,
    };
  }
}

async function serviceFixture(): Promise<{ service: ProImageService; fake: FakeAdapters; output: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "proimage-service-test-"));
  const output = path.join(directory, "output");
  const configPath = path.join(directory, "proimage.env");
  await writeFile(configPath, `PROIMAGE_PRESETS=HIGH\nPROIMAGE_DEFAULT_PRESET=HIGH\nPROIMAGE_OUTPUT_DIR=${output}\nPROIMAGE_PRESET_HIGH_ADAPTER=openrouter-images\nPROIMAGE_PRESET_HIGH_API_KEY=secret\nPROIMAGE_PRESET_HIGH_MODEL=openai/gpt-image-2\nPROIMAGE_PRESET_HIGH_CAPABILITIES=text_to_image,image_to_image,transparent\nPROIMAGE_PRESET_HIGH_OPTIONS_JSON={"quality":"high","output_format":"png"}\n`, "utf8");
  const config = new ConfigManager(configPath);
  const fake = new FakeAdapters();
  const service = new ProImageService(config, fake as unknown as AdapterRegistry);
  await service.initialize();
  return { service, fake, output };
}

test("generation uses preset defaults and saves one image", async () => {
  const { service, fake } = await serviceFixture();
  const result = await service.generate({ prompt: "transparent glass icon", background: "transparent" });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent?.ok, true);
  assert.equal(result.structuredContent?.generated, true);
  assert.equal(result.structuredContent?.alphaCheck, "not_performed");
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0]?.parameters.background, "transparent");
  assert.equal(fake.calls[0]?.parameters.quality, "high");
  await access(String(result.structuredContent?.path));
  service.configManager.close();
});

test("conflicting adapter options fail before a provider request", async () => {
  const { service, fake } = await serviceFixture();
  const response = await service.generate({
    prompt: "test",
    quality: "high",
    adapter_options: { quality: "low" },
  });
  assert.equal(response.isError, true);
  assert.equal(response.structuredContent?.failureType, "invalid_arguments");
  assert.equal(fake.calls.length, 0);
  service.configManager.close();
});

test("magic detection and sanitization preserve metadata without secrets or base64", () => {
  assert.deepEqual(detectImage(PNG), { mime: "image/png", extension: "png" });
  const cleaned = sanitize({
    api_key: "secret",
    url: "https://example.invalid/run?key=secret&mode=one",
    image: "data:image/png;base64,AAAA",
    prompt: "keep this",
  }) as Record<string, unknown>;
  assert.equal(cleaned.api_key, "[REDACTED]");
  assert.match(String(cleaned.url), /key=%5BREDACTED%5D/);
  assert.match(String(cleaned.image), /BASE64_DATA_OMITTED/);
  assert.equal(cleaned.prompt, "keep this");
});
