import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { AdapterRegistry } from "../src/adapters.js";
import type { Preset } from "../src/types.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

test("OpenRouter adapter sends the dedicated image shape with one output and reference data URLs", async () => {
  let received: Record<string, unknown> | undefined;
  let authorization: string | undefined;
  const server = createServer((request, response) => {
    authorization = request.headers.authorization;
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.setHeader("content-type", "application/json");
      response.setHeader("x-request-id", "local-request");
      response.end(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }], usage: { cost: 0.01 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const preset: Preset = {
    id: "LOCAL",
    displayName: "Local",
    adapter: "openrouter-images",
    apiKey: "test-secret",
    baseUrl: `http://127.0.0.1:${address.port}/api/v1/images`,
    model: "openai/gpt-image-2",
    tier: "high_paid",
    capabilities: ["text_to_image", "image_to_image", "transparent"],
    description: "",
    options: {},
    timeoutMs: 5_000,
  };
  try {
    const result = await new AdapterRegistry().execute({
      preset,
      prompt: "make it transparent",
      parameters: { quality: "high", background: "transparent", output_format: "png" },
      images: [{ path: "C:\\reference.png", bytes: PNG, mime: "image/png" }],
      maxOutputBytes: 1024,
      connectTimeoutMs: 1_000,
    });
    assert.equal(authorization, "Bearer test-secret");
    assert.equal(received?.model, "openai/gpt-image-2");
    assert.equal(received?.n, 1);
    assert.equal(received?.quality, "high");
    assert.equal(received?.background, "transparent");
    const references = received?.input_references as Array<Record<string, unknown>>;
    assert.equal(references.length, 1);
    assert.match(JSON.stringify(references[0]), /data:image\/png;base64/);
    assert.equal(result.requestId, "local-request");
    assert.ok(result.bytes.equals(PNG));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
