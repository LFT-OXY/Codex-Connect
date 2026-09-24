# adapter-claude-code

> 通用约定见 `.atw/spec/adapters/node/index.md`（包结构、工厂、会话契约、测试）。本文只写 Claude Code 特有的内容。

## 职责与边界

`@codexhost/adapter-claude-code` 用 `@anthropic-ai/claude-agent-sdk` 驱动用户本机已安装的 `claude` CLI，把 SDK 消息流投影成公共 `HarnessSession` 事件，并从 Claude 的 transcript JSONL 读取历史。

- 依赖（`package.json`）：`@anthropic-ai/claude-agent-sdk` `0.3.220`（精确版本）、`@anthropic-ai/sdk`、`@modelcontextprotocol/sdk`、`zod`，以及 `harness-adapter`、`harness-broker`、`harness-discovery`、`shared-contracts`。
- 下游：`packages/host-runtime/test/*claude*` 和 `harness-session-import.test.ts` 直接导入本包。`desktop-control` 的 `build-release.mjs` 禁止把 `@anthropic-ai/` 或本包打进它的 Bundle。
- Broker：`plugin.ts` 在 `darwin && managedRemoteHost` 时返回 `BrokeredHarnessAdapter`（由 `@codexhost/harness-broker` 提供，协议文件名仍是 `claude-code-broker-v1`）。Broker 一端（`host-runtime/src/aqua-harness-broker.ts`，运行在登录 LaunchAgent 中）再通过插件 Loader 构造出真正的 `ClaudeCodeAdapter`。修改 `ClaudeCodeAdapterOptions` 或 resume/rollback 的输入时，要同时确认 Broker 转发的字段（`docs/harnesses/claude-code/claude-code-edit-recovery.md` 已说明：保存的选择提示需要匹配版本的 Broker）。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [sdk-session.md](./sdk-session.md) | 改 SDK 调用、进程生命周期、Turn/Segment、交互、历史、Fork/Rollback、Model/Thinking/权限时 |
| `src/claude-code-adapter.ts`（约 3000 行） | `ClaudeHarnessSession` + `ClaudeCodeAdapter`；**不要再往里加新职责**，新逻辑放到下列专项模块 |
| `src/sdk-transport.ts` | `ClaudeSdkTransport`（`query()` 封装、spawn、`canUseTool`）、`ClaudeSdkModelInspector` |
| `src/transport.ts` | Transport 接口与 `ClaudeAdapterDependencies`，测试从这里注入 |
| `src/native-message.ts` | `ClaudeNativeTurnAccumulator`：SDK 消息 → Turn 事件 |
| `src/claude-history.ts`、`claude-transcript.ts`、`item-identity.ts` | transcript 读取与快照投影 |
| `src/claude-fork.ts`、`pending-session.ts` | Fork / Rollback / 空会话预留 |
| `src/tool-lifecycle.ts`、`subagent-lifecycle.ts`、`task-tracker.ts`、`background-occupancy.ts`、`file-change.ts` | 工具、Subagent、Todo、后台占用、文件 diff 投影 |
| `src/model-catalog.ts`、`thinking-options.ts`、`permission-modes.ts`、`plan-review.ts` | 配置编码与计划审批 |
| `src/slash-commands.ts`、`account-usage.ts`、`usage-estimate.ts`、`claude-session-import.ts` | 命令目录、账号额度、费用估算、导入 |
| `src/user-shell-environment.ts`、`process-fence.ts`、`command.ts` | 环境、进程组回收、可执行文件发现 |
| `docs/harnesses/claude-code/claude-code-plan-mode.md`、`claude-code-edit-recovery.md` | 计划模式与修订/空会话恢复的设计说明 |

## 改动前检查清单

1. 需要新的原生能力时，先确认 SDK `0.3.220` 的类型里是否真的提供（`node_modules/@anthropic-ai/claude-agent-sdk`）。不要用 Prompt 去模拟权限模式或命令（plan mode 文档：“直接使用这些接口，不通过提示词模拟权限模式”）。
2. 改 Turn 事件投影时，同时检查实时路径（`native-message.ts`）和历史路径（`claude-history.ts`）是否生成相同的 Item ID（`claudeTranscriptItemId`）。
3. 改 inspect 或 Session 的 capabilities 时，两处字面量（`claude-code-adapter.ts` 第 501 行、第 2740 行）要一起改。
4. 新增构造参数时，确认 `plugin.ts` 的直连和 Broker 两条分支都能拿到它。
5. 涉及进程关闭时，保持“关闭确认前 Transport 仍属于 Session”的不变量（`claude-code-adapter.ts` 第 2422 行、第 2456 行注释）。
6. 定向验证：
   ```sh
   npx vitest run --config tests/vitest.config.js packages/adapters/claude-code/test/claude-code-adapter.test.ts packages/adapters/claude-code/test/sdk-transport.test.ts
   npx vitest run --config tests/vitest.config.js packages/adapters/claude-code/test/claude-history.test.ts packages/adapters/claude-code/test/claude-rollback.test.ts
   CODEXHOST_RUN_CLAUDE_ADAPTER_REAL=1 npx vitest run --config tests/vitest.config.js packages/adapters/claude-code/test/claude-code-adapter.real.test.ts
   ```
