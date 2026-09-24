# adapter-cursor-cli（Node）

> 通用约定见 `.atw/spec/adapters/node/index.md`（plugin.ts 工厂、manifest、HarnessResult、command.ts、测试组织）。本目录只写 Cursor CLI 特有的内容。

`@codexhost/adapter-cursor-cli` 把 `cursor-agent acp`（官方 ACP over stdio）接成 Host 的 Harness 会话。Cursor 私有扩展（`cursor/*` 方法、参数化模型目录、原生 SQLite 历史、CLI `/fork` + `/rewind`）只在本包内解释；Host Runtime、Protocol Core、Renderer 不导入本包。manifest 名称是 "Cursor CLI (Experimental)"，按实验性 Harness 对待。

## 依赖（`package.json` / `tsconfig.json#references`）

| 依赖 | 用途 |
|---|---|
| `@agentclientprotocol/sdk` 1.3.0 | `ClientSideConnection` + `ndJsonStream`，见 `src/transport.ts` |
| `@modelcontextprotocol/sdk` 1.30.0、`zod` | 仅 `src/delegation-bridge.ts`：每会话 loopback HTTP MCP 服务器 |
| `@codexhost/harness-broker` | 仅 `src/plugin.ts`：`context.platform === "darwin" && context.managedRemoteHost` 时返回 `BrokeredHarnessAdapter`（macOS SSH/Remote Control 下经 Aqua broker 保留登录钥匙串）。`tools/check-boundaries.mjs` 不限制 Adapter → harness-broker，claude-code / codebuddy / workbuddy 也这样用 |
| `diff` 8.0.2 | `src/projection.ts` 用 `createTwoFilesPatch` 生成 fileChange |
| `@codexhost/harness-discovery` | `src/command.ts` 解析 `cursor-agent`（`CODEXHOST_CURSOR_COMMAND` 覆盖） |

Node 内置 `node:sqlite`（`DatabaseSync`、`backup`）是读取原生历史和 Fork 的硬依赖。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [native-protocol.md](native-protocol.md) | 改 transport、会话生命周期、模型/Thinking/模式配置、权限与问题交互、事件投影、子代理、委派 MCP、slash 命令 |
| [history-and-fork.md](history-and-fork.md) | 改 resume/快照、原生 turn 身份、Fork、修订上一条（rollbackLastTurn）、smoke 脚本 |

源码职责速览：

| 源码 | 职责 |
|---|---|
| `src/adapter.ts`（788 行） | `CursorAdapter`（inspect/open/fork/子代理快照）与 `CursorSession`（execute/readSnapshot/#run）。已接近 800 行，新职责放独立模块 |
| `src/transport.ts` | `CursorTransport`：进程、ACP 握手、`open/configure/prompt/cancel/close` |
| `src/models.ts`、`src/thinking.ts` | 参数化模型目录 → Host Model Ref / Thinking 组合、`CURSOR_CAPABILITIES`、`CURSOR_MODES` |
| `src/interactions.ts` | `CursorInteractions`：`requestPermission`、`cursor/create_plan`、`cursor/ask_question` |
| `src/projection.ts`、`src/subagents.ts` | ACP 通知 → Host Item；历史回放 `cursorSnapshot`；原生 Task 卡片 |
| `src/native-history.ts` | 只读解码 `acp-sessions/<id>/store.db` 的 turn 身份 |
| `src/fork.ts`、`src/fork-terminal.ts`、`src/fork-support.ts` | Fork/修订事务、PTY 驱动 CLI、平台门禁与 checkpoint 形状 |
| `src/slash-commands.ts` | 原生 `available_commands_update` → Host 命令目录 |
| `src/delegation-bridge.ts` | 向外委派的会话级 MCP 工具 |

## 不支持的能力（有意为之，不要补"等价实现"）

- **Usage / 账户**：原生 ACP agent 既不发 usage 更新也不在 prompt 结果里带 usage，`CursorSession.initialUsage = null`（`src/adapter.ts`）。
- **上下文压缩**：`/compact` 不在 ACP slash 处理器里；把 `/compact` 当普通文本发送不算压缩（`docs/harnesses/capability-boundaries.md` Cursor 节）。
- **入站无人值守**：`#openSession` 对 `executionPolicy === "unattended-full-access"` 直接返回 `unsupported`，因为 `--force` 可能被团队策略静默降级，ACP 只报告 Agent/Plan/Ask，无法确认实际审批策略。
- **Windows Fork/修订、跨工作区 Fork**：`cursorForkAvailable()` 要求 darwin/linux 且存在 `/usr/bin/script`；`CURSOR_CAPABILITIES.history.forkAcrossCwd = false`。
- **非文本输入**：`turn.start` 只接受非空 text part，否则 `invalidRequest`。

## 改动前检查清单

1. 改进程启动/关闭或超时：同时对照 `packages/adapters/grok/src/acp-transport.ts`、`packages/adapters/kiro-cli/src/acp-transport.ts`（两者结构高度相似）、`packages/adapters/kimi-code/src/acp-transport.ts`（独立实现）。`CursorTransport` 是第四套独立实现，没有共享代码，修复通常要逐个评估是否同样存在。
2. 任何配置写入必须以 `setSessionConfigOption` 响应里的 `currentValue` 为准再更新 `initialState`，不要乐观更新（见 native-protocol.md「配置」）。
3. 新增对原生私有格式（`store.db`、CLI 终端文本）的依赖时，必须失败即关闭（抛错），不能回退为数组下标、UUID 或文本哈希当作 native turn key。
4. 改 `native-history.ts`/`fork.ts` 时确认源数据库只读打开，且 Fork 只写入自己用 `mkdir`（非 recursive）独占创建的目标目录。
5. 未知的 `cursor/*` 阻塞扩展必须返回 `rejected`，不要假装已执行（`CursorInteractions.extension` 末尾）。
6. 不要把 stderr 转发给 Host：`transport.ts` 里 `child.stderr.resume()` 注释说明原生诊断可能含密钥。
7. 改能力声明时同步 `docs/harnesses/cursor/cursor-cli-experimental.md` 与 `docs/harnesses/capability-boundaries.md`。

## 验证

```sh
npx vitest run --config tests/vitest.config.js packages/adapters/cursor-cli/test
npx vitest run --config tests/vitest.config.js packages/adapters/cursor-cli/test/transport.test.ts
```

测试必须在仓库根目录运行：`transport.test.ts` 通过 `vi.mock("../src/command.js")` 把命令替换成 `process.execPath test/fixtures/acp.mjs <scenario>`，fixture 路径用 `path.resolve("packages/adapters/cursor-cli/test/fixtures/acp.mjs")` 相对 cwd 解析。`fork-terminal.test.ts` 用 `it.skipIf(!cursorForkAvailable())`，`delegation-bridge.test.ts` 在 win32 整体跳过。
