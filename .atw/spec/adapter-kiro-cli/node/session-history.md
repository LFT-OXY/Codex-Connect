# 会话、历史、Fork 与回滚

## 原生历史来源（`src/history.ts`）

- 历史快照读取的是磁盘数据，不用 ACP replay：`${KIRO_HOME ?? ~/.kiro}/sessions/<bucket>/<sessionId>/session.json` 加上同目录下的 `messages.jsonl`。`locateKiroNativeSession` 遍历 `sessions/` 下的一级目录，跳过 `cli`。cwd 取 `session.json.workspacePaths[0]`。
- `loadSession` 期间 ACP 推送的事件会被收进 `#replay`，但 `KiroAdapter.open` 只从中读取 `usage`，不会拿 replay 重建历史。
- `messages.jsonl` 中每一行都必须带 `id` 和 `payload.type`，否则抛错（`readKiroNativeMessages`）。
- tombstone 语义（`effectiveHistory`）：
  - `checkpoint_revert`：截掉 `effectiveFromMessageId` 及其之后的行，被回退的回合从显示中消失。
  - `summarization`：显示时保留原回合，计算有效上下文时截掉。
  - 因此“显示历史”和“有效上下文”是两套集合，别混用，参见 `history.test.ts` 用例 “removes reverted turns without confusing compaction…”。
- Fork 出来的会话只保存有效上下文。它的第一条消息如果是 `operationType === "Summary"`，`readKiroSessionMessages` 会沿 `parentSessionId` 递归读取父会话，并在 Summary 的 id 处拼接父会话的显示前缀。递归有防环检查；父会话或拼接边界找不到时直接抛错，不做静默降级。
- 快照投影规则：
  - `nativeTurnKey` = 用户消息 id。
  - checkpoint = `forkMessageId`：取 `turn_end`；该回合被压缩时取仍然有效的 Summary 行。
  - `Reasoning` 投影为 reasoning Item，Summary 不显示。
  - 最后一段可见的 assistant 文本且回合成功时，才标记为 `final_answer`。
  - 没有 `tool_result` 的工具，结果为 `cancelled`。
  - `stopReason` 无法识别时为 `unknown`。
- `nativeRef.locator` = `{ engine: "v3", kind: "local-session-directory", sessionDirectory }`。
- `KiroSession.readSnapshot` 在回合进行中或配置写入中返回 `sessionBusy`，因为此时 Kiro 正在写历史。新建但还没有回合的 Session 遇到 `ENOENT` 时返回空快照。

## Fork 与回滚（`KiroAdapter.open`）

能力声明（`KIRO_SESSION_CAPABILITIES`）：`fork`、`forkAcrossCwd`、`rollbackLastTurn` 均为 true。两者都走原生 `session/fork`，没有文件复制，也没有改写 JSONL：

1. 定位源会话 → `readKiroSessionMessages` → `parseKiroHistory`。
2. 计算边界：
   - Fork 用 `findForkBoundary(summary, checkpointId)`。
   - 回滚用 `findRollbackBoundary`：取上一回合的 `forkMessageId`；只有一个回合时取 bootstrap 行。
3. `#forkSession` 发出 `session/fork { sessionId, cwd: <目标 cwd>, _meta.kiro.messageId }`，然后 `loadSession` 新 id，恢复源会话 `session.json` 里记录的 model、autopilot、effort。

需要注意的地方：

- 边界不存在时，Adapter 先返回 `checkpointNotFound`（Fork）或 `unsupported`（回滚），不会去调原生接口。如果原生返回 “message not found”，`#forkSession` 同样映射为 `checkpointNotFound`，提示用户刷新历史后从最新保留的位置 Fork。
- 原生返回的 sessionId 与源会话相同，或者返回 `-32601`，都按 `protocolError` 处理，不回退到其他实现。
- 只有一个回合、且压缩删除了 bootstrap 时，“修改上一条消息”会改走 `create`，带上源会话的 `agentMode`、Model、effort 和 autopilot，得到一个空 Session（`createdEmptySession`）。参见 `kiro-adapter.test.ts` 用例 “edits the sole compacted Turn by creating an empty Session…”。
- `KiroForkOpenInput.sourceCwd` 和 `KiroRollbackOpenInput.sourceCwd` 当前没有被 `#forkSession` 使用，跨 cwd 实际只依赖 `cwd: this.#options.cwd`。修改时不要默认原生侧收到了源 cwd。

## 实时回合输出（`src/turn-output.ts#KiroTurnOutput`）

- 一个 Prompt 对应一个实例。已经发布的 Item 对象不再修改，文本通过 `text.append` 增量更新。
- 回合进行中所有文本先按 `commentary` 输出；`finish()` 时，如果回合成功，把最后一条消息改为 `final_answer`。消息之间用原生 `messageId` 或工具开始事件来切分。
- 没有对应开始事件的 `tool.update` 属于初始化阶段的残留，直接丢弃。工具的 Item 类型如果在更新中发生变化，就抛错。
- 文件 Diff 预览（`#fileOutput`）不算已提交的改动：只有终态更新确认了 Diff，才算 `succeeded`，否则为 `cancelled`（原因是 Kiro 没有确认预览的修改）。`sourceItemIds` 指向对应的工具 Item。
- 当前 Transport 定义了 `agent.thought` 事件类型，但 `#handleUpdate` 没有映射 `agent_thought_chunk`，`KiroTurnOutput` 也不处理它，所以实时回合里没有 reasoning，只能从历史快照中的 `Reasoning` 行看到。要补上这条链路时，Transport 和 TurnOutput 两处都得改。
- `visible-text.ts#KiroVisibleText` 专门去掉 Kiro 文本流里泄漏的、单独成行且未闭合的 `<｜DSML｜function_calls` 前导，代码围栏（```、~~~）内的内容保留原样。实时流和历史快照都经过这个过滤，但用户消息和工具内容不过滤。测试 `visible-text.test.ts` 覆盖了所有位置的分块切割。

## 文件 Diff（`src/file-diff.ts`）

- 只接受 ACP 中 `type: "diff"` 的 content。每个工具最多 32 个文件，同一路径不能出现两次，文本总量上限 4 MiB，超出任一条件就整体返回 `null`，不做部分投影。路径必须位于 cwd 内才转成相对路径，含 `\0` 或换行的路径直接拒绝。

## Usage（`src/usage.ts#KiroUsage`）

- 只发布原生提供的两项：`totalCredits`（`promptTurnSummaries` 中 `unit === "credit"` 的部分）和 `contextUsagePercent`。不编造 token、窗口大小或缓存计数（`usage.test.ts`）。
- 同一笔扣费以 `requestIds`（排序去重后作为键）或 `executionId` 为键，这样实时通知、replay 和 `messages.jsonl` 里的 `usage_summary` 重复出现时不会被计入两次。
- 回合结束后 `refreshUsage()` 会重读 `messages.jsonl`；只有空闲时才调用 `_kiro/session/context`，失败不会导致 fault。

## 子代理

- 能力声明为 `subagents: { observe: true, readTranscript: false }`，`autonomousTurns.observe: false`。
- 带 `_meta.kiro.kind === "agent-subtask"` 的工具调用会被 `projectKiroToolCall` 投影为 `subagentDelegation`（`operation: "spawn"`）。其中 `subagentId` 取 `agentSubtaskId`，状态随工具 status 变化。本包没有读取子代理 transcript 的实现，不要在 Host 侧假设可以展开子代理对话。

## 定向测试

```
npx vitest run --config tests/vitest.config.js packages/adapters/kiro-cli/test/history.test.ts
npx vitest run --config tests/vitest.config.js packages/adapters/kiro-cli/test/turn-output.test.ts
npx vitest run --config tests/vitest.config.js packages/adapters/kiro-cli/test/kiro-adapter.test.ts
```
