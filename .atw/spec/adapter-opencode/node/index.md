# adapter-opencode（Node）

> 通用约定见 `.atw/spec/adapters/node/index.md`（plugin.ts 工厂、manifest、HarnessResult、command.ts、测试组织等）。本目录只写 OpenCode 特有内容。

`@codexhost/adapter-opencode` 为每个 Session 拉起一个受管的 `opencode serve --hostname=127.0.0.1 --port=0` 进程，通过固定版本的 `@opencode-ai/sdk`（`/v2/client`，HTTP + SSE）把 OpenCode 接入为 Harness。不走 ACP，也不解析 TUI 或 `opencode run --format json`，理由见 `docs/harnesses/opencode/opencode-harness-integration-analysis.md` 的“为什么首选 Server + SDK”一节。

- 依赖（`package.json`）：`@opencode-ai/sdk@1.18.25`（精确版本）、`@codexhost/harness-adapter`、`@codexhost/harness-discovery`、`@codexhost/shared-contracts`。`@opencode-ai/sdk` 同时列在 `scripts/release/harness-plugins.json` 的 `runtimePackages` 中。
- 运行时只从 `@opencode-ai/sdk/v2/client` 取值（`server-connection.ts`）；`@opencode-ai/sdk/v2` 只允许 `import type`（`protocol.ts`、`opencode-adapter.ts`）。SDK 顶层 `v2` 入口会把 `createOpencodeServer()` 和 `cross-spawn` 一起打进包里，与本包自己的进程监管职责重复。
- 可执行文件：`CODEXHOST_OPENCODE_COMMAND`（`plugin.ts` 与 `command.ts` 的 `openCodeDiscoverySpec` 都用这个变量），安装根目录额外包含 `~/.opencode/bin`。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [server-and-turns.md](server-and-turns.md) | 改受管 Server、SDK transport、SSE 重连、Turn 准入与完成、取消、Question/Approval、Permission Mode、Model/variant 时 |
| [history-and-derivation.md](history-and-derivation.md) | 改历史投影、Checkpoint、Fork、回滚上一轮、Diff/FileChange、Usage 时 |
| `docs/harnesses/opencode/opencode-edit-recovery.md` | 消息编辑恢复语义与真实 Gate 的运行方式 |
| `docs/harnesses/opencode/opencode-harness-integration-analysis.md` | 原生 API 证据和设计取舍（“当前分支的落地状态”一节部分过期，见下文） |

## 源码地图（`packages/adapters/opencode/src`）

| 文件 | 职责 |
|---|---|
| `opencode-adapter.ts`（约 1800 行） | `OpenCodeAdapter`（inspect/open）与 `OpenCodeHarnessSession`（Turn 准入/完成、SSE 投影、交互、配置、重连对账） |
| `server-connection.ts` | `OpenCodeServerConnection`：spawn、Basic Auth、监听地址解析、health、进程树关闭；`managedOpenCodeEnvironment` |
| `sdk-transport.ts` | `SdkOpenCodeTransport`：`OpenCodeTransport` 接口（`protocol.ts`）的 SDK 实现、命令超时、SSE 泵与重连 |
| `history.ts` / `history-projection.ts` / `history-derivation.ts` | 历史投影与 Native Ref；Diff 对账与 selection metadata；Fork/回滚派生及校验 |
| `file-change-verification.ts` | worktree 与文件路径的 realpath 校验 |
| `model-catalog.ts` / `permission-modes.ts` / `usage.ts` | Model Ref 与 variant；三种 Permission Mode 与 PermissionRuleset；Usage |

## 技术债与文档差异

- `opencode-adapter.ts` 约 1800 行。设计文档已说明为什么暂时不继续拆：Turn 准入/完成、SSE 投影、状态投影、重连对账共享 `ActiveTurn`、准入缓冲和“恰好一次完成”不变量。新增能力优先放进 `history-*.ts`、`server-connection.ts`、`sdk-transport.ts` 这类已拆出的模块；要拆状态机，先为跨模块的事件顺序补契约测试。
- 集成分析文档“当前明确不对外声明”列表里仍写着 Permission Mode 与 `unattended-full-access` 等条目，但代码已声明 `selectPermissionMode: true` 并实现了这些能力（`permission-modes.ts`、`managedOpenCodeEnvironment`）。以代码为准。

## 改动前检查清单

1. 调用 `promptAsync()` 时**不要**注入 `messageID`：OpenCode 靠可排序 ID 判断最新消息，随机 UUID 会让 Agent Loop 在 `finish=stop` 后继续循环（集成分析文档“Turn、事件流与完成边界”）。
2. 只有 `parentID` 指向本 Turn 用户消息的 Assistant Part 才能投影为 Host 输出。仅凭 User 事件不能绑定（`#handleEvent` 注释：可能有其他原生客户端同时写入）。
3. 审批只回复 `once` 或 `reject`，`OpenCodeTransport.replyPermission` 的类型已排除 `always`：原生 `always` 作用于整个 Server 进程且不持久化。
4. 新增会写原生状态的派生逻辑时，失败只能删除本次确认创建的候选 Session（`createdForCleanup`），不能调用 `unrevert()`，也不能动源 Session。
5. Model/variant 选择写入 `metadata["codexhost.selection.v1"]`，写入时保留其他原生 metadata（`selectionMetadata`）。
6. 能力声明在 Session 构造函数和 `#inspectCwd` 两处，改动需同步；`forkAcrossCwd` 保持 `false`，除非跨 cwd 的历史、工具路径和文件安全 Gate 已通过。

## 定向验证

```bash
npx vitest run --config tests/vitest.config.js packages/adapters/opencode/test/opencode-adapter.test.ts packages/adapters/opencode/test/sdk-transport.test.ts
npx vitest run --config tests/vitest.config.js packages/adapters/opencode/test/history.test.ts packages/adapters/opencode/test/file-change-verification.test.ts packages/adapters/opencode/test/model-catalog.test.ts packages/adapters/opencode/test/command.test.ts packages/adapters/opencode/test/usage.test.ts
# 真实 CLI（本地假模型，不接真实账号；gate 导入 dist，需先构建；未设置时跳过）
npm run build:typescript
CODEXHOST_OPENCODE_REAL_COMMAND=$(which opencode) npx vitest run --config tests/vitest.config.js \
  packages/adapters/opencode/test/opencode-adapter.real.test.ts \
  packages/adapters/opencode/test/opencode-adapter.rollback.real.test.ts \
  tools/gate-opencode/cancel.real.test.mjs
```
