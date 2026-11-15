#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ProImageService } from "./service.js";

const commonShape = {
  prompt: z.string().min(1).describe("完整图片提示词。"),
  preset: z.string().min(1).optional().describe("预设 ID；省略时使用配置中的 default。"),
  background: z.enum(["auto", "transparent", "opaque"]).optional(),
  size: z.string().min(1).optional(),
  aspect_ratio: z.string().min(1).optional(),
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  output_format: z.enum(["png", "jpeg", "webp"]).optional(),
  output_compression: z.number().int().min(0).max(100).optional(),
  seed: z.number().int().optional(),
  adapter_options: z.record(z.string(), z.unknown()).optional().describe("适配器原生参数；不得与通用参数传入不同值。"),
};

const server = new McpServer({ name: "proimage", version: "0.1.1" });
const service = new ProImageService();

server.registerTool(
  "proimage_get_presets",
  {
    title: "获取 ProImage 预设",
    description: "列出当前的图片生成与编辑预设、模型、支持的能力和默认预设。",
    inputSchema: {},
  },
  async () => service.getPresets(),
);

server.registerTool(
  "proimage_generate",
  {
    title: "ProImage 文生图",
    description: "使用配置中的预设生成一张图片，返回本地路径和本次调用费用。",
    inputSchema: commonShape,
  },
  async (args) => service.generate(args),
);

server.registerTool(
  "proimage_edit",
  {
    title: "ProImage 图生图",
    description: "使用本地参考图和可选蒙版编辑一张图片，返回本地路径和本次调用费用。",
    inputSchema: {
      ...commonShape,
      images: z.array(z.string().min(1)).min(1).describe("一张或多张输入图片的绝对路径。"),
      mask: z.string().min(1).optional().describe("可选蒙版的绝对路径。"),
    },
  },
  async (args) => service.edit(args),
);

async function main(): Promise<void> {
  await service.initialize();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`ProImage MCP failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
