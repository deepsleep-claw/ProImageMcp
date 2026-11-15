# ProImage QuickStart

这份指南分为两条路径：**给人类的手动教程**和**给 Agent 的安装任务卡**。两种方式使用相同的配置位置与验证标准。

## 准备

开始前需要：

- Node.js **22.19 或更新版本**，可用 `node --version` 检查。
- 一个支持 stdio 的 MCP 客户端；Codex 推荐使用插件安装。
- OpenRouter、OpenAI 或 Gemini 的 API key，以及对应模型的使用权限。

GitHub 仓库为 `deepsleep-claw/ProImageMcp`；`/absolute/path/to/repo` 表示仓库在本机的绝对路径。Windows 的 JSON 配置可使用 `C:/...` 形式的正斜线路径。

## 给人类：手动安装

### 方式一：Codex 插件（推荐）

```sh
codex plugin marketplace add deepsleep-claw/ProImageMcp
codex plugin add proimage@image-mcp-local
```

重新打开 Codex 并新建聊天，确认出现 `proimage_get_presets`、`proimage_generate` 和 `proimage_edit`。如果 CLI 没有 `plugin add`，添加市场后可在桌面应用的插件目录选择 **ProImage Plugins**，安装 **ProImage**。

### 方式二：其他 MCP 客户端

下载仓库到固定目录；发布仓库已包含可运行的 bundle，无需先执行 npm 安装或构建：

```sh
git clone https://github.com/deepsleep-claw/ProImageMcp.git
```

服务启动参数统一为：

| 配置项 | 值 |
| --- | --- |
| 传输方式 | `stdio` |
| 命令 | `node` |
| 参数 | `/absolute/path/to/repo/plugins/proimage/dist/index.js` |

支持 `mcpServers` 结构的客户端可合并以下配置；请保留文件中已有的其他服务器和设置：

```json
{
  "mcpServers": {
    "proimage": {
      "command": "node",
      "args": ["/absolute/path/to/repo/plugins/proimage/dist/index.js"]
    }
  }
}
```

不同客户端的入口如下。未使用 `mcpServers` 结构的客户端，仍使用上面的同一个 `node` 命令和 bundle 路径。

| 客户端 | 安装或配置入口 | 补充说明 |
| --- | --- | --- |
| Claude Code | `claude mcp add --transport stdio --scope user proimage -- node "/absolute/path/to/repo/plugins/proimage/dist/index.js"` | 也可使用项目 `.mcp.json`；[官方文档](https://code.claude.com/docs/en/mcp) |
| Codex 直接 MCP | `codex mcp add proimage -- node "/absolute/path/to/repo/plugins/proimage/dist/index.js"` | 插件已安装时不要重复注册；[官方文档](https://learn.chatgpt.com/docs/extend/mcp#connect-codex-to-an-mcp-server) |
| Cursor | 用户级 `~/.cursor/mcp.json` 或项目级 `.cursor/mcp.json` | 使用通用 JSON；[官方文档](https://prod.cursor.com/help/customization/mcp) |
| VS Code / Copilot | 工作区 `.mcp.json` 或 Copilot 的 MCP 设置 | 使用通用 JSON；旧 Local 配置可能采用 `servers` 根键；[官方文档](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) |
| Gemini CLI | 用户级 `~/.gemini/settings.json` 或项目级 `.gemini/settings.json` | 使用通用 JSON，可设 `timeout: 1200000`；[官方文档](https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html) |
| Antigravity | MCP Servers 的原始配置，通常为 `~/.gemini/config/mcp_config.json` | 使用通用 JSON，可设 `timeoutSeconds: 1200`；[官方文档](https://antigravity.google/docs/mcp) |
| ZCode | **设置 → MCP 服务器 → 新建 MCP 服务器**，选择 stdio | 原生配置文件结构不同，按界面或[官方文档](https://zcode.z.ai/cn/docs/mcp-services)填写相同启动参数 |
| DeepSeek Harness | 通过 `@deepseek-ai/dsh-mcp-client` 添加 stdio 服务 | 使用相同启动参数，工具超时可设 `1200000` ms；[官方文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md) |

ProImage 默认单次请求超时为 15 分钟。客户端的工具调用超时应大于实际使用的预设超时；各客户端的字段名称和单位并不相同，以其官方文档为准。

### 初始化配置

1. 重启客户端并新建会话，让助手调用一次 `proimage_get_presets`。首次启动会创建配置目录和示例文件。
2. 在示例文件同目录复制一份 `proimage.env.example`，命名为 `proimage.env`。如果配置已经存在，不要覆盖。
3. 打开 `proimage.env`，把 `replace-with-your-openrouter-key` 替换为自己的 OpenRouter key。使用其他服务商时，按模板字段调整适配器、模型和 key。
4. 再次调用 `proimage_get_presets`，确认 `config.state` 为 `ready`。

默认路径不再按操作系统分散设置：

| 系统 | 配置文件 | 首次生成的示例 |
| --- | --- | --- |
| Windows | `%USERPROFILE%\.proimage-mcp\proimage.env` | 同目录的 `proimage.env.example` |
| Linux | `~/.proimage-mcp/proimage.env` | 同目录的 `proimage.env.example` |

也可以直接复制仓库中的 [`proimage.env.example`](../proimage.env.example) 到上述位置。需要自定义路径时，在 MCP 进程环境中设置绝对路径 `PROIMAGE_CONFIG_PATH`。

`ready` 只表示本地配置格式有效，不代表 key、余额或模型权限已经通过服务商验证。配置保存后会热重载；无效的新配置不会覆盖最后一次有效快照。

### 生成与编辑

在客户端中输入：

```text
使用 ProImage 生成一张清晨薄雾中的森林小屋，水彩插画风格。
```

编辑本地图片时，提供运行 MCP 的主机上的绝对路径：

```text
使用 ProImage 编辑图片，参考图路径为 /absolute/path/to/reference.png。
```

成功后主要返回：

- `path`：图片的绝对路径。
- `metadataPath`：同名生成参数 JSON 的路径。
- `cost`：可用的美元费用；`cost.usd: null` 表示费用未知，不代表免费。
- `alphaCheck`：当前为 `not_performed`，插件不会解码验证透明通道。

图片默认保存在 `~/Pictures/ProImage/YYYY-MM-DD`。完整调用参数可由客户端读取工具 schema；预设字段和可选全局设置见[配置模板](../proimage.env.example)。

### 更新 Codex 插件

```sh
codex plugin marketplace upgrade image-mcp-local
codex plugin add proimage@image-mcp-local
```

更新后重新打开 Codex 并新建聊天。配置和生成图片位于插件安装目录之外，不会随插件更新被清空。

## 给 Agent：安装任务卡

把下面整段发给具备终端和文件操作能力的 Agent。先替换目标客户端；API key 由用户在本机自行填写，不要贴进对话。

```text
请在这台机器上安装并验证 ProImage MCP，目标客户端是【填写客户端】，GitHub 仓库是 deepsleep-claw/ProImageMcp。

执行要求：
1. 先检查 node --version，要求 Node.js >= 22.19。若环境不满足，停止并说明需要用户完成的操作，不要自行安装系统软件。
2. 如果当前没有源码，先将仓库克隆到用户认可的固定目录。阅读 plugins/proimage/docs/QUICKSTART.md，选择与目标客户端匹配的安装方式。Codex 优先使用插件市场；其他客户端使用仓库中的 plugins/proimage/dist/index.js，并以 stdio 启动。
3. 修改客户端配置前，先读取并保留已有内容，只合并 proimage 条目，不覆盖其他 MCP 服务器。路径必须使用当前运行环境中的真实绝对路径。
4. 默认配置位置是用户目录下的 .proimage-mcp/proimage.env：Windows 使用 %USERPROFILE%\.proimage-mcp\proimage.env，Linux 使用 ~/.proimage-mcp/proimage.env。除非我明确要求，不要改用其他位置。
5. 如果配置不存在，复制 plugins/proimage/proimage.env.example 到该位置；如果已存在，不要覆盖、移动或打印其内容。需要示例时，首次调用 proimage_get_presets 也会在同目录生成 proimage.env.example。
6. 不要索要、显示、记录或提交 API key。告诉我用本地编辑器把模板中的 replace-with-your-openrouter-key 替换为真实 key，然后由我继续后续验证。
7. 不要执行 git add、git commit，也不要把 proimage.env 放进仓库。不要未经我确认调用 proimage_generate 或 proimage_edit，因为真实调用可能产生费用。
8. 安装后确认 bundle 文件存在，并用 node --check plugins/proimage/dist/index.js 做静态语法检查，不要用启动常驻进程冒充客户端验证。需要重启客户端时，明确告诉我重启并新建会话，再继续。
9. 最终调用 proimage_get_presets，确认 config.state 为 ready，并核对 proimage_get_presets、proimage_generate、proimage_edit 三个工具可用。
10. 汇报安装方式、修改过的客户端配置、配置路径、验证结果和未验证事项。没有实际完成的步骤不得声称成功。
```

如果 Agent 无法在当前会话加载新 MCP 工具，合理流程是：完成安装与配置后，请用户重启客户端，再在新会话执行第 9 步；不要反复启动多个服务器进程冒充验证成功。

## 常用设置

以下设置写入 `proimage.env`；路径必须为绝对路径，数值必须为正整数。

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `PROIMAGE_OUTPUT_DIR` | `~/Pictures/ProImage` | 图片与元数据输出根目录 |
| `PROIMAGE_TIMEOUT_MS` | `900000` | 单次 HTTP 请求超时，15 分钟 |
| `PROIMAGE_CONNECT_TIMEOUT_MS` | `30000` | 连接超时，30 秒 |
| `PROIMAGE_MAX_INPUT_BYTES` | `52428800` | 每个输入文件上限，50 MiB |
| `PROIMAGE_MAX_TOTAL_INPUT_BYTES` | `209715200` | 输入文件总上限，200 MiB |
| `PROIMAGE_MAX_OUTPUT_BYTES` | `104857600` | 输出图片上限，100 MiB |
| `PROIMAGE_LOG_RETENTION_DAYS` | `30` | 日志保留天数 |

预设支持 `openrouter-images`、`openai-images` 和 `gemini-native` 三种适配器。尺寸、质量、参考图数量、蒙版和透明背景等能力最终取决于服务商与模型；本地能力声明不会赋予模型额外能力。蒙版传输仅由 `openai-images` 实现。

自定义服务地址时优先使用 HTTPS。HTTP 会明文传输 API key、提示词和参考图，只应在可信的本机开发环境中使用。

## 故障排查

| 现象 | 检查与处理 |
| --- | --- |
| 工具未出现 | 检查 Node.js 版本、bundle 绝对路径、服务器是否启用，并重启客户端后新建会话 |
| `config_missing` | 调用 `proimage_get_presets` 查看实际 `configPath` 与 `examplePath`，复制示例后再填写 |
| `config_invalid` | 检查预设 ID、必填字段、默认预设及 `OPTIONS_JSON` 是否为单行 JSON 对象 |
| 修改后仍使用旧配置 | 查看 `config.state`；无效编辑会继续使用最后一次有效配置 |
| 401 / 403 / 模型不可用 | 检查 key、余额、模型权限与接口地址；`ready` 不代表服务商验证成功 |
| `unsupported_capability` | 检查预设能力声明和模型实际能力；蒙版仅支持 `openai-images` |
| 客户端提前结束调用 | 让客户端工具超时大于 ProImage 的请求超时，注意秒与毫秒的区别 |
| 输入或输出过大 | 检查单文件、总输入和输出字节上限；蒙版也计入总输入 |

## 数据存储与隐私

- 提示词、所选参考图和蒙版会发送给当前预设的服务商；服务商的数据处理与收费规则由对应服务商决定。
- 图片默认保存在 `~/Pictures/ProImage/YYYY-MM-DD`。同名 JSON 包含提示词、参考图本机路径、生成参数、模型、用量与费用。
- 诊断日志位于系统临时目录的 `proimage-mcp/logs`，默认保留 30 天。
- JSON 与日志会对凭据和图片原始数据脱敏，但提示词和文件路径仍可能包含个人信息，分享前应自行检查。
- 配置文件包含明文密钥，只应保存在受信任的本机位置，不应提交到 Git 或粘贴到公开对话。
