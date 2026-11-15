# ProImage MCP 插件包

本地 stdio MCP 图像生成与编辑插件，支持 OpenRouter Images、OpenAI Images 和 Gemini 原生接口。

**安装与使用请阅读 [QuickStart](docs/QUICKSTART.md)**，其中包含：

- Codex 与其他 MCP 客户端的手动安装步骤。
- 可直接交给安装 Agent 执行的任务卡。
- 配置、验证、更新、故障排查及隐私说明。

## 包内容

- 运行入口：`dist/index.js`
- 配置模板：`proimage.env.example`
- 默认配置：`~/.proimage-mcp/proimage.env`
- 工具：`proimage_get_presets`、`proimage_generate`、`proimage_edit`
- 运行要求：Node.js 22.19 或更新版本

发布包已包含运行依赖，无需在使用前执行 npm 安装或构建。

## 本地开发

```sh
npm ci
npm run check
npm run smoke
```

`npm run check` 执行 TypeScript 检查、构建和单元测试。更新发布源码时，一并提交 `dist/index.js` 与 `dist/THIRD_PARTY_NOTICES.txt`，使 GitHub 安装可以直接启动。

## 许可证

[MIT](LICENSE)。打包依赖适用各自许可证，见[第三方声明](dist/THIRD_PARTY_NOTICES.txt)。
