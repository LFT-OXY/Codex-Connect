# adapter-antigravity（Node）

> 通用约定见 `.atw/spec/adapters/node/index.md`（plugin.ts 工厂、manifest、HarnessResult、command.ts、测试组织）。本目录只写 Antigravity CLI（`agy`）特有的内容。

`@codexhost/adapter-antigravity` 通过 `agy` 的 headless print 模式（`--input-format stream-json --output-format stream-json`）接入 Antigravity。它**不使用 ACP**：`package.json` 里没有 `@agentclientprotocol/sdk`，只依赖 `@codexhost/harness-adapter`、`@codexhost/harness-discovery`、`@codexhost/shared-contracts` 和 `zod`。grok / kiro-cli / kimi-code / cursor-cli 的 `acp-transport.ts` / `transport.ts` 与本包无关，不要照搬它们的 ACP 概念，例如 session/load、configOptions 或 requestPermission。

## 原生接口一览

| 能力 | 原生入口 | 代码 |
|---|---|---|
| Turn | 每个 Turn 启动一个 `agy` 进程，stdin 写一行 `{"event":"user",...}`，stdout 输出 NDJSON | `AntigravitySession.execute`（`antigravity-adapter.ts`） |
| 续接 | `--conversation <nativeSessionId>` | 同上 |
| Model 目录 | `agy models`（TSV 格式） | `model-catalog.ts#parseAntigravityModels` |
| Account 额度 | 单独调用 `agy --print=/usage --output-format stream-json` | `quota.ts#fetchAntigravityQuota` |
| 上下文用量、文件 diff、子代理 | 本地 Language Server 的 HTTPS gRPC-JSON（`exa.language_server_pb.LanguageServerService/*`），端口从 `--log-file` 日志中解析 | `antigravity-adapter.ts#antigravityHttpsPort`、`code-action-diff.ts`、`subagent-transcript.ts` |
| 提问 | 私有 `PreToolUse` Hook，只匹配 `^ask_question$`，通过 `--add-dir` 注入 | `question-bridge.ts`、`question-hook-client.ts` |
| 历史 / Fork / 回滚 | agy 不向 headless 客户端提供历史，因此由 codexhost 维护 sidecar，并复制 agy 的私有 SQLite | `history.ts`、`fork.ts`、`rollback.ts` |

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [turn-lifecycle.md](turn-lifecycle.md) | 修改进程启动参数、stream 事件处理、工具/文件变更投影、取消与关闭、权限模式、提问桥 |
| [history-fork-subagents.md](history-fork-subagents.md) | 修改 sidecar 历史、Fork、回滚上一轮、子代理观察与 transcript |
| `src/antigravity-adapter.ts`（约 1780 行） | 包含 `AntigravitySession` 与 `AntigravityAdapter`。**技术债：不要继续往里堆新职责**，新功能按主题建独立模块，参考已拆出的 `fork.ts`、`rollback.ts`、`subagents.ts`、`question-bridge.ts` |
| `src/stream-events.ts` | stream-json 事件形状与 `parseAntigravityStreamLine` |
| `src/tool-projection.ts` / `src/code-action-diff.ts` | 工具名归一化、命令/工具 Item、真实 diff |
| `src/model-catalog.ts` | Model 与 effort（Thinking）拆分 |
| `src/permission-modes.ts` | 唯一的权限模式 |
| `src/slash-commands.ts` | 静态命令目录 |
| `src/quota.ts` | `/usage` 额度解析 |

设计背景：`docs/harnesses/antigravity/antigravity-tool-approval.md`、`antigravity-subagents.md`、`antigravity-question-interaction-postmortem.md`，以及 `docs/harnesses/capability-boundaries.md` 的“Antigravity 工具审批与压缩”一节。

## 能力与边界（`CAPABILITIES` 常量）

- `configuration`：`selectModel`、`selectThinkingOption`、`selectPermissionMode`，`permissionModeScope: "live"`。
- `history`：`fork: true`、`forkAcrossCwd: true`、`rollbackLastTurn: true`。
- `subagents`：`observe: true`、`readTranscript: true`。子 Thread 只读。
- **不支持上下文压缩**：原生 headless 命令目录没有 `/compact` 或 `/compress`，也没有压缩事件（见 capability-boundaries）。不要发送“请总结”这类 Prompt 来冒充 `contextCompaction`。
- **不支持工具审批**：只提供 `dangerously-skip-permissions` 模式，详见 turn-lifecycle.md。
- 命令目录是静态的 `ANTIGRAVITY_COMMAND_CATALOG`，包括 `/plan`、`/goal`、`/browser`、`/grill-me`、`/boost`、`/learn`、`/schedule`、`/help`。`docs/architecture/harness-command-integration.md` 说明了原因：agy 没有原生的命令列举接口。`#executeHarnessCommand` 把命令拼成 `"/plan <text>"` 后走普通 `turn.start`。`formatAntigravityTurnPrompt` 对以 `/` 开头的文本不追加系统指令。

## 改动前检查清单

1. 修改 stream 事件处理前，先用真实 `agy` 抓取 stdout 样本。postmortem 第 4 节记录过一次事故：测试用 `fakeStreamingAgy` 虚构了 `step_type: "tool"` + `tool_name: "ask_question"`，测试全部通过，但真实 CLI 根本不输出这些字段。
2. 新增的原生能力必须来自 agy 已公开或实测过的入口，例如 CLI 参数、Language Server RPC、Hook。不要在 Adapter 内重建 agy 的权限策略或压缩逻辑。
3. 每次改动都要确认 `ActiveTurn.queue` 仍然保证串行：所有 stream 工作都经过 `#enqueue`，不能让 await Language Server 的步骤被后续事件超车。
4. 修改 Fork 或回滚时，同时检查 `fork.ts` 与 `rollback.ts`。两者结构几乎相同，`antigravity-adapter.ts#open` 里两段 `createSession` 回调也是重复的。
5. 新增 Language Server 调用前，先看现有的三处 `https.request` 实现（`requestAntigravityContextUsage`、`requestAntigravityTrajectorySteps`、`subagentRpc`）。三者都用 `rejectUnauthorized: false` 访问 `127.0.0.1`，并各自设置了超时。
6. 任何外发的 stderr 或原生拒绝文本都必须先经过 `sanitizeDiagnosticTail`（见 `normalizedProcessError`、`permissionDeniedTurnError`），因为这些文本可能回显命令行和凭据。
7. 本包内的 Fork、回滚、提问桥与 grok 的 `grok-fork.ts`、`grok-rewind.ts`，以及 cursor-cli 的 `fork.ts`、`fork-terminal.ts` 各自独立实现，原生机制完全不同，不要跨包抽取共用代码。

## 定向验证

```bash
npx vitest run --config tests/vitest.config.js packages/adapters/antigravity/test/antigravity-adapter.test.ts
npx vitest run --config tests/vitest.config.js packages/adapters/antigravity/test/fork.test.ts packages/adapters/antigravity/test/rollback.test.ts packages/adapters/antigravity/test/adversarial-fork-rollback.test.ts
npx vitest run --config tests/vitest.config.js packages/adapters/antigravity/test/question-bridge.test.ts packages/adapters/antigravity/test/skip-permissions.test.ts
npx vitest run --config tests/vitest.config.js packages/adapters/antigravity/test/subagents.test.ts
```

真实 CLI 测试默认跳过，运行时会消耗原生模型用量：

- `CODEXHOST_RUN_ANTIGRAVITY_QUESTION_REAL=1` → `packages/host-runtime/test/antigravity-question.real.test.ts`
- `CODEXHOST_RUN_ANTIGRAVITY_SUBAGENTS_REAL=1` → `packages/host-runtime/test/antigravity-subagents.real.test.ts`

证据目录由 `CODEXHOST_ANTIGRAVITY_*_EVIDENCE_DIR` 指定，其中的运行日志不要提交。
