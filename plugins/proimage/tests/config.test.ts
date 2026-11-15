import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfigManager, parseConfigText, resolveConfigPath } from "../src/config.js";

function configText(outputDir: string, model = "openai/gpt-image-2"): string {
  return `PROIMAGE_PRESETS=GPT_IMAGE\nPROIMAGE_DEFAULT_PRESET=GPT_IMAGE\nPROIMAGE_OUTPUT_DIR=${outputDir}\nPROIMAGE_PRESET_GPT_IMAGE_ADAPTER=openrouter-images\nPROIMAGE_PRESET_GPT_IMAGE_API_KEY=test-key\nPROIMAGE_PRESET_GPT_IMAGE_MODEL=${model}\nPROIMAGE_PRESET_GPT_IMAGE_TIER=high_paid\nPROIMAGE_PRESET_GPT_IMAGE_CAPABILITIES=text_to_image,image_to_image,transparent\nPROIMAGE_PRESET_GPT_IMAGE_OPTIONS_JSON={"quality":"high","output_format":"png"}\n`;
}

test("uses one home-relative default config path", () => {
  const previous = process.env.PROIMAGE_CONFIG_PATH;
  delete process.env.PROIMAGE_CONFIG_PATH;
  try {
    assert.equal(resolveConfigPath(), path.join(os.homedir(), ".proimage-mcp", "proimage.env"));
  } finally {
    if (previous === undefined) delete process.env.PROIMAGE_CONFIG_PATH;
    else process.env.PROIMAGE_CONFIG_PATH = previous;
  }
});

test("parses underscore preset config and built-in defaults", () => {
  const config = parseConfigText(configText(path.join(os.tmpdir(), "proimage-output")));
  const preset = config.presets.get("GPT_IMAGE");
  assert.ok(preset);
  assert.equal(config.defaultPreset, "GPT_IMAGE");
  assert.equal(preset.adapter, "openrouter-images");
  assert.equal(preset.baseUrl, "https://openrouter.ai/api/v1/images");
  assert.equal(preset.options.quality, "high");
  assert.deepEqual(preset.capabilities, ["text_to_image", "image_to_image", "transparent"]);
});

test("first run creates an example; reload is atomic and preserves the last valid snapshot", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "proimage-config-test-"));
  const configPath = path.join(directory, "proimage.env");
  const manager = new ConfigManager(configPath);
  await manager.initialize();
  assert.equal(manager.status.state, "missing");
  assert.match(await readFile(`${configPath}.example`, "utf8"), /openai\/gpt-image-2/);

  await writeFile(configPath, configText(path.join(directory, "output")), "utf8");
  await manager.reloadIfChanged(true);
  assert.equal((await manager.getConfig()).presets.get("GPT_IMAGE")?.model, "openai/gpt-image-2");

  await writeFile(configPath, "PROIMAGE_PRESETS=GPT_IMAGE\n", "utf8");
  await manager.reloadIfChanged(true);
  assert.equal(manager.status.state, "invalid");
  assert.equal((await manager.getConfig()).presets.get("GPT_IMAGE")?.model, "openai/gpt-image-2");

  await writeFile(configPath, configText(path.join(directory, "output"), "openai/gpt-image-2-new"), "utf8");
  await manager.reloadIfChanged(true);
  assert.equal((await manager.getConfig()).presets.get("GPT_IMAGE")?.model, "openai/gpt-image-2-new");
  manager.close();
});
