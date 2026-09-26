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
| `src/claude-native-usage.ts` | `nativeUsage.read` 的原生用量解析，规则见下文「原生用量」 |
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

## 原生用量（`claude-native-usage.ts`）

跨层契约见 `.atw/spec/host-runtime/node/local-usage.md`。Claude 特有规则（`test/claude-native-usage.test.ts` 固化）：

- 进度：列出文件后 `onProgress?.({ processed: 0, total: files.length })`，每个文件处理完（包括读取中被删除而跳过的）后报 `index + 1`；Adapter 的 `nativeUsage.read(cursor, onProgress)` 原样传给读取函数（`read…NativeUsage(environment, cursor, signal, onProgress)`）。
- 文件：`claudeProjectsDirectory(env)` 下 `<project>/*.jsonl`（主会话）与 `<project>/<session>/subagents/*.jsonl`（子代理）。游标 `{formatVersion:1, files:{[相对路径]:{ino(字符串，bigint stat), offset}}}`；ino 变化或 offset 超过文件大小从 0 重读。
- 只读到最后一个 `\n`，未写完的尾行下次再读。只解析含 `"usage"` 或 `"type":"user"` 的行（大段附件行不 parse）。
- 用量：`type:"assistant"` 且有 `message.usage`；去重键 `message:<message.id>:<requestId>`（无 requestId 时省略）。同一回复会写多行：主会话每个内容块一行、用量相同；子代理先写 `stop_reason:null` 的部分用量，**工具结果可能先于最终用量行写入**。取同键的最后一行。
- 流式等待：最后一行 `stop_reason` 为空且文件 1 小时内有写入（`STREAMING_WINDOW_MS`）时不交出，游标退回到该回复第一行；闲置超过 1 小时按最后一行交出（中断的回复）。不要用“其后是否有新消息”判断完成，这会在工具结果先写入时少计。
- `reasoning` 恒为 0：Claude transcript 的思考量只包含在 `output_tokens` 中。全零用量（如 `<synthetic>` 错误回复）不交出。
- 对话：只在主会话文件，`type:"user"`、非 `isSidechain`、content 为字符串或含 text 块（不计 tool_result），去重键 `prompt:<uuid>`，不带 model。与 TokenTracker 口径一致，`isMeta` 等命令回显也会计入。
