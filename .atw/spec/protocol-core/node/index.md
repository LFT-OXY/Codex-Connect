# protocol-core（Node）

`@codexhost/protocol-core` 在 Host 公共事件（`@codexhost/harness-adapter` 的 `HostItem`、`TurnCompletedEvent`、`HostApprovalInteraction` 等）与 Codex Desktop app-server 的 JSON-RPC wire 形状之间做**无状态解码和投影**。它不做 I/O，不持有 Session，也不了解任何 Harness 的私有协议。Host 的路由决策和写出由 `host-runtime` 负责。

## 上下游

- 依赖（`package.json`）：`shared-contracts`（JSON 类型、ID schema、`encodeHarnessPluginRoute`）、`harness-adapter`（Host 事件类型、`parseHostUsage`）、`mapping-store`（只用来引用 `packageMetadata`），第三方只有 `diff`。
- 下游：生产代码中只有 `host-runtime` 导入它。`adapters/kiro-cli` 在 package.json 里声明了依赖，但只在测试中使用 `CodexTurnProjector` / `projectHistoricalTurn` 做端到端投影断言。
- `src/index.ts` 是唯一的公开面。`codex-ui-projector.ts` 里 `export` 的 `toolCommandLine`、`fileChangeFromTool`、`todoPlanFromTool`，以及 `file-change-summary.ts` 的 `summarizeFileChanges` 都**没有**从 index 导出，属于包内实现，不要在其他包依赖它们。
- 运行形态是 Node：`jsonl.ts` 用 `node:stream`，`thread-management.ts` 用 `node:crypto`，`file-change-summary.ts` 用 `node:path`。不能被 renderer 导入。浏览器需要的类型放在 `shared-contracts`。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [protocol-mapping.md](./protocol-mapping.md) | 修改任何投影、解码、路由编码、JSONL 分帧，或新增 Codex wire 字段时 |

源码职责速查：

| 源文件 | 职责 |
|---|---|
| `codex-ui-projector.ts`（约 1360 行） | `CodexTurnProjector`（每个 Turn 一个实例，处理实时事件）和 `projectHistoricalTurn`（从 Snapshot 一次性投影） |
| `codex-approval.ts` / `codex-question.ts` | Host Interaction → Desktop server request，以及回复的解析 |
| `file-change-summary.ts` | 合并同一文件的多次原生 patch，得到净 diff |
| `thread-fork.ts` | `thread/fork`、`revert`、`rollback` 的解码，结果封装，以及 `mapExternalThreadHarnessError` |
| `thread-management.ts` | `thread/list` 解码、Host 分页游标、archive/metadata 解码、官方分页校验 |
| `model-routing.ts` | `thread/start.params.model` 的路由编解码，包括 7 种旧专用编码和插件路由 |
| `codex-usage.ts` / `codex-native-usage.ts` | 上下文用量投影；官方 token/rate-limit 通知观测 |
| `jsonl.ts` | LF 分帧读写（Desktop ↔ Host ↔ 官方 app-server 共用） |

## 改动前检查清单

1. 新增的投影要同时覆盖实时路径（`CodexTurnProjector.project`）和历史路径（`projectHistoricalTurn`），测试中对两条路径断言相同的 Desktop 文本。
2. 不要加入 `harnessId === …` 或 Harness 名称判断。原生形状的差异应由 Adapter 规范化成公共 `HostItem`，例如 Claude Task 先由 Adapter 转成 Todo。
3. `model-routing.ts` 不为新 Harness 添加专用常量或分支。新 Harness 走 `encodeHarnessPluginRoute`，已有的 7 种编码只保留读取兼容。
4. 解码函数遵循"方法不匹配返回 `null`，参数非法 `throw new Error("<method> params.<field> …")`"的约定。Host 会把抛出的 message 原样作为 `-32602` 返回，所以 message 中不能夹带原生正文或凭据。
5. 修改 `mapExternalThreadHarnessError` 的码值前，先对照 host-runtime 的错误码表（`.atw/spec/host-runtime/node/error-handling.md`）并 grep `renderer-extension/src`。
6. `codex-ui-projector.ts` 已经超过 800 行。新的独立主题（例如新的一类工具卡片解析）放进新文件，由 projector 调用，参照 `file-change-summary.ts`。
7. 定向验证：`npx vitest run --config tests/vitest.config.js packages/protocol-core/test/<file>.test.ts`。本包测试都是纯逻辑，依赖包需要先 `npm run build:typescript` 生成 `dist`。
