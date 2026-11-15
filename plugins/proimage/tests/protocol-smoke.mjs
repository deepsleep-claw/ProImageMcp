import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), "proimage-protocol-smoke-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve(here, "../dist/index.js")],
  env: { ...process.env, PROIMAGE_CONFIG_PATH: path.join(temporary, "proimage.env") },
  stderr: "pipe",
});
const client = new Client({ name: "proimage-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
    "proimage_edit",
    "proimage_generate",
    "proimage_get_presets",
  ]);
  const result = await client.callTool({ name: "proimage_get_presets", arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent?.ok, false);
  assert.equal(result.structuredContent?.config?.state, "missing");
  assert.ok(String(result.structuredContent?.config?.examplePath).endsWith("proimage.env.example"));
  process.stdout.write("MCP stdio smoke passed: 3 tools, missing-config bootstrap reported correctly.\n");
} finally {
  await client.close();
}
