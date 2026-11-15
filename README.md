# ProImage MCP

通过可配置的图像服务生成和编辑图片的本地 MCP 插件。支持 Codex 插件市场，也能接入其他支持 stdio 的 MCP 客户端。

- 文生图、参考图编辑和可选蒙版，每次调用保存一张图片。
- 支持 OpenRouter Images、OpenAI Images 和 Gemini 原生接口。
- 本地保存图片及生成参数，返回文件路径、服务商用量和可用的美元费用。
- 配置热重载，可切换服务商、模型和默认预设。
- 默认配置统一位于用户目录：`~/.proimage-mcp/proimage.env`。

## 快速开始

**[打开 QuickStart](plugins/proimage/docs/QUICKSTART.md)**：包含给人类的手动教程，以及可交给安装 Agent 执行的任务卡。

Codex 用户只需先安装插件：

```sh
codex plugin marketplace add deepsleep-claw/ProImageMcp
codex plugin add proimage@image-mcp-local
```

安装、配置、其他客户端接入和故障排查均以 QuickStart 为准。

## 可用工具

| 工具 | 用途 |
| --- | --- |
| `proimage_get_presets` | 查看配置状态、预设、默认预设和能力 |
| `proimage_generate` | 根据提示词生成一张图片 |
| `proimage_edit` | 使用本地参考图与可选蒙版编辑一张图片 |

配置模板见 [`proimage.env.example`](plugins/proimage/proimage.env.example)。需要 Node.js 22.19 或更新版本，以及所选图片服务的 API key。

## 本地开发

```sh
cd plugins/proimage
npm ci
npm run check
npm run smoke
```

`npm run check` 会执行 TypeScript 检查、构建和单元测试；`npm run smoke` 验证 stdio 协议与首次配置引导。

发布源码更新时，一并提交 `dist/index.js` 和 `dist/THIRD_PARTY_NOTICES.txt`，确保 GitHub 安装无需构建即可启动。

## 数据与隐私

提示词、所选参考图和蒙版会发送给当前预设的服务商，并适用该服务商的数据处理与收费规则。图片默认保存到 `~/Pictures/ProImage/YYYY-MM-DD`；同名 JSON 和诊断日志可能包含提示词与本机路径，分享前请检查。

配置文件包含明文密钥，不应提交到 Git 或粘贴到公开对话。详见 [QuickStart 的数据存储与隐私说明](plugins/proimage/docs/QUICKSTART.md#数据存储与隐私)。

## 许可证

[MIT](LICENSE)。打包依赖的许可证见 [第三方声明](plugins/proimage/dist/THIRD_PARTY_NOTICES.txt)。
