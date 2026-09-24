# DSH：日志、历史投影、Fork 与修订

## 日志读取（`modern/journal.ts`）

- `openModernJournal` 先打开 `session/follow` 流，得到一个不可变的历史切片，以及紧接其后、已经在运行的实时后继；不完整的历史再用 `session/page` 分页补全。一个 journal 对象只对应一次打开（“single-generation”）。需要重新读取时，关闭后重新打开，不要在原对象上重置。
- 所有上限都是模块常量，超出就报 `limitExceeded` 或 `protocolError`：每页 200 条消息、单条记录 32 MB、历史 1,000,000 事件 / 128 MB、实时缓冲 8192 事件 / 32 MB，恢复打开超时 10s。不要为了“能打开大会话”去放宽这些上限。
- `ModernJournalDesyncError` 只用于一种情况：Assistant 展示出现短暂缺口，可以用新的打开 baseline 修复。其他错误不能借用这个类型来触发重连。
- V3/V4 的 `session/follow` 请求带 `assistantStream: true`（`profile.assistantStream`），V0 不带。

## 事件信封与严格校验（`profiles/journal-format.ts`、`modern/history.ts`）

- 信封必须恰好包含 `type`、`seq`、`time`、`data`，可选字段只有 `ignorable`（只能为 `true`）、`sourceEventSeqs`、`surfaceOp`。`sourceEventSeqs` 中的每个值都必须小于当前 seq 且不重复。`surfaceOp` 的键名在 V0 为 `start` / `end`，在 V3 及以后为 `startSeq` / `endSeq`。
- `ModernEventValidator` 由初始历史投影和实时 Session 共用，保证两条路径使用同一套规则。
  - 事件类型不在 `KNOWN_EVENT_TYPES` 中：如果带 `ignorable: true` 就跳过，否则报 `Modern history contains an unknown required event`。**新的 DSH 事件要显式加入白名单**，不要把未知事件默认当作可忽略。
  - V4 额外允许 `developer/message`、`image/offload`、`workspace/changes`（`V4_EVENT_TYPES`）。
  - 只有 surface 事件（`system/message`、`user/message`、`assistant/message`、`tool/result`，V4 还包括 `developer/message`）可以携带 `surfaceOp` / `sourceEventSeqs`，只写日志的事件携带这些字段就报错。
- V3 的 `system/message` 参与 surface 引用和替换，但不作为用户 Turn 展示。
- 真实样本：`test/fixtures/dsh-015rc1-empty-response-retry.v3.jsonl` 原样取自 DSH `dsh-v0.1.5-rc.1` 标签的快照，只补回了 seq/time，并用最小工具声明替换了 `{{tools}}`。修改 V3 解析时应该继续用它做回归，不要改写样本来迁就代码。

## 标识

| 标识 | 形式 | 位置 |
|---|---|---|
| Native Turn key | `turn:<n>`（原生 `turn/start.data.turn`） | `modernNativeTurnRef` |
| Checkpoint ID | `<profile.checkpointPrefix><turn/end 的 seq>`；V3/V4 带 `locator: { dshVersion }` | `modernCheckpointRef` |
| Host Item ID | `dsh-modern:<sessionId>:<key>` | `modernItemId` |
| Native Session Ref | `formatVersion: 1`；V3/V4 带 `locator: { dshVersion }` | `deepseek-harness-adapter.ts` |

版本兼容规则（`sessionLocatorMatches` / `checkpointLocatorMatches`）：
- **Session Ref** 在 DSH 升级后可以尝试重新打开，只要格式相同，或者从 V3 升级到 V4；之后仍然必须通过实际的日志 header 和历史解析。
- **Checkpoint** 必须与创建它的 DSH 版本**完全一致**。原生迁移可能会重新编号 seq，用旧 seq 执行 Fork 或回滚会切到错误的位置，所以在修改原生会话之前就要拒绝。

## Fork（`#forkSession`、`#verifyForkJournal`）

1. `parseModernForkInput`：`sourceRef` 与 `checkpoint` 必须指向同一个 Native Session，并且 locator 符合上面的规则。
2. 打开源日志，用 `resolveModernForkBoundary` 找出切点：`events[atSeq]` 必须是 `turn/end`。V4 精确切在 `atSeq + 1`；V0/V3 一直延伸到下一个 `turn/start` 之前（这一段包含尾随的非 Turn 事件）。切出的前缀投影后，最后一个 Turn 的 checkpoint 必须等于请求的 checkpoint，并且不能有未完成的 Turn。
3. 调用 `session/fork { sessionId, atSeq }`，返回的 `sessionId` 必须非空且与源不同。
4. 打开子日志并校验：`header.parentSession` 与 `cwd` 一致；`inheritedEventCount`（seed 长度）不小于前缀长度，在 V4 或前缀被截断时必须精确相等；继承部分与源的原始事件逐个 `isDeepStrictEqual`；尾部满足 `profile.matchesForkTail`（V0/V3 需要 `session/end-seed` 标记，V4 需要 `reason.kind === "forked"` 的合成 `turn/end` 收尾）。
5. **子会话已经创建但校验失败时**：Host 不接收这个子会话，返回固定的 `FORK_ORPHAN_MESSAGE`，并且 `retryable: false`。子会话会作为孤儿留在 DSH 中；本包不删除原生 Session。

`history.forkAcrossCwd` 为 `false`：Fork 使用请求的 `cwd` 打开源日志和子日志，header 中的 cwd 必须一致。

## Fork 继承的待办（`modern/fork-inbox.ts`，仅 V3/V4）

DSH 015 的原生 Fork 可能把下一个 Turn 的待处理输入也继承过来，冷恢复时这些输入会被重新执行。接收子会话之前：
- `pendingForkInboxIds` 只接受能证明来自 seed 的待办；来源不明时报 `protocolError`，不做猜测。
- 逐条调用 `session/updateQueue { action: { kind: "remove" } }`，**不重试**（remove 与 cancel 在原生语义上不同）。
- 关闭并重新打开日志，再做一次 Fork 校验，要求没有剩余待办，然后调用 `flushSession` 确认已落盘。

## rollbackLastTurn（`#resolveLastTurnRollback`）

DSH 没有“原地回滚”接口；修订通过**原生 Fork**生成一个新 Session，源 Session 保持不变：
- 源 Session 有未完成的 Turn 时报 `sessionBusy`，没有任何 Turn 时报 `invalidState`。
- 有 2 个或更多 Turn 时，在倒数第二个 Turn 的 checkpoint 处 Fork，流程与上一节相同。
- 只有 1 个 Turn 时，用 `session/create` 新建一个空 Session，沿用源 Session 当前的 `agentPreset`；打开后必须确认 `agentPreset` 一致，并且投影结果中没有任何 Turn。
- 无论走哪条分支，新 Session 的 `agentPreset` 都要与源 Session 一致，否则报协议错误。
