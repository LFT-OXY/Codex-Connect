# Grok 历史、Fork、回滚与子代理

## 历史映射（`grok-history.ts` 的 `mapGrokReplay`）

- **Snapshot 的唯一来源是原生 `updates.jsonl`**。Session 打开时，以及每次 Turn 开始前和结算时，都会调用 `#refreshSnapshot` 重新读文件并完整映射，不维护一份与原生状态并行的内存副本。
- Turn 身份：`nativeTurnKey` 取 `turn_completed.prompt_id`；如果没有这个字段，依次回退到用户事件的 `metadata.eventId` 和 `messageId`。三者都没有时直接抛错（"has no stable identity"）。与 `knownTurnRefs` 同 key 的 Turn 沿用已有 ref，保证 live 与 resume 两条路径得到的身份一致（测试 "keeps Native Turn identity stable across live completion and resume"）。
- Checkpoint：`checkpointId = String(promptIndex)`（`grokCheckpointId`）。promptIndex 优先取用户事件上的 `metadata.promptIndex/prompt_index`，否则自增。Fork 和 Rewind 都依赖“checkpointId 就是原生 Prompt Index”这个等式，修改时两边必须一起改。
- 需要跳过的合成内容，每一类都有对应测试：
  - 以 `<system-reminder>` 开头的用户文本：会占用一个 Prompt Index，但不生成 Turn（测试 "maps Host Turn past a synthetic Prompt to the Native Prompt Index"）。
  - `prompt_id` 以 `task-completed-` 开头的 `turn_completed`：属于后台任务控制记录（测试 "omits background-task control records without shifting persisted Turn identities"）。
  - `metadata.hostTurn/host_turn === true` 的用户事件。
- `rewind_marker` 会丢弃 `promptIndex >= targetPromptIndex` 的 Turn，并重置当前 Turn 状态。历史末尾如果没有终止信号，Turn 结果记为 `unknown`。
- Item ID 用 `grok-history-<kind>-<turn>-<index>`（`stableId`），保证重复读取时 ID 稳定。

## live Turn 结算

- Turn 开始前记录已有 Turn 的 `nativeTurnKey` 集合（`beforeNativeTurnKeys`）。prompt 结束后重读历史，**必须恰好多出 1 个 Native Turn**，否则原本成功的结果会改为 `protocolError`（`#settleFromHistory`）。`nativeTurnRef` 和 `checkpoint` 取自这个新 Turn，不由 live 事件推断。
- 结算前会顺带刷新 Credits，失败时忽略。

## Fork（`grok-fork.ts` 的 `forkGrokSession`）

- 使用原生扩展 `_x.ai/session/fork`，参数为 camelCase：`sourceSessionId`、`sourceCwd`、`newCwd`、`targetPromptIndex`，以及可选的 `sessionKind` 和 `sourceWorkspaceDir`。fork 完成后调用标准 `session/load` 加载新会话。如果 load 失败，错误信息里要带上已创建的 newSessionId（"Fork succeeded as … but session/load failed"）。
- 流程：
  1. 校验 checkpoint 与 source 是否属于同一 Session
  2. 用 `locateGrokNativeSession` 找到源 cwd
  3. 读取源 Snapshot，并把 checkpoint 解析为 promptIndex
  4. fork 并 load
  5. **校验**：重读源 Snapshot 和子 Snapshot，要求
     - 源前缀没有变化
     - 子 Snapshot 与源前缀逐 Turn 深度相等（忽略 itemId，文件路径按项目相对路径比较）
     - 子 Snapshot 的所有 ref 都指向新 Session

  任一条件不满足时，调用 `_x.ai/session/delete` 删除子会话并返回 `protocolError`。
- 跨 cwd 的 Fork 使用 `sessionKind: "worktree"`，并传入 `sourceWorkspaceDir = located.sourceWorkspaceDir ?? sourceCwd`。如果源会话本身就是 Worktree，保留它原来的 workspace（测试 "keeps the original workspace when the source is already a Worktree"）。同 cwd 时使用 `"fork"`。
- Method Not Found 返回 `unsupported`；其他失败返回可重试的 `nativeFailure`。checkpoint 过期时，在调用原生接口之前就返回 `checkpointNotFound`。

## 回滚上一轮（`grok-rewind.ts` 的 `rewindGrokLastTurn`）

- Host 的 `open({ kind: "rollbackLastTurn" })` 会先 `session/load` 源会话，再调用 `_x.ai/rewind/execute { sessionId, targetPromptIndex, force: true, mode: "conversation_only" }`。回滚在**原会话上就地截断**，不生成新 Session：返回的 sessionId 必须等于源会话 ID，而且 cwd 必须与源会话一致。
- 校验：回滚后 Turn 数必须等于原来减 1，并且剩余 Turn 的 `nativeTurnKey` 与原来的前缀逐一相等。只有一个 Turn 时可以回滚到空历史。`success: false` 时抛出带原生错误文本的 `unavailable`。
- `GROK_REWIND_POINTS_METHOD`（`_x.ai/rewind/points`）只在 index 里导出，当前没有被调用。
- 请求固定使用 `mode: "conversation_only"`，本包没有任何工作区文件回退逻辑，因此不要把这个能力描述成文件回退。

## 子代理（`grok-subagent.ts` 与 `grok-subagent-lifecycle.ts`）

- 按工具名识别子代理操作：
  - spawn：`spawn_subagent`、`spawn_agent`、`task`
  - send：`send_subagent_message`
  - wait：`get_command_or_subagent_output`、`get_task_output`、`wait_tasks`
  - kill：`kill_command_or_subagent`、`kill_task`

  原生事件 `subagent_spawned/finished` 通过 `subagent_id/child_session_id` 与工具调用关联。
- spawn 默认视为后台运行（`background ?? true`），**spawn 工具完成不代表子代理已完成**：成功时子代理状态保持 `running`（`completeSpawn` 中的 `keepRunning` 判断）。以下三种情况才会结束子代理：wait 返回终态、收到 `subagent_finished`、kill 工具成功。kill 工具失败不能说明子代理已经停止。
- 子代理的 `model` 只取 spawn 参数或 `subagent_spawned.model`，后者优先。适配器目前不传 `reasoningEffort`：lifecycle 支持这个字段，但 Grok 没有提供可观测的来源，所以不要补上。原因见 `docs/harnesses/grok/subagent-status-and-model.md`。
- transcript：`GrokAdapter.subagents.readSnapshot` 先定位子会话的 cwd，再读取子会话的 `updates.jsonl` 并用 `mapGrokReplay` 映射，但 `nativeSessionId` 仍然使用**父会话**的（代码注释说明这是为了与 Host 子代理记录的身份保持一致）。得到的 transcript 只读，不会打开可写的 Session。
- 父会话历史回放时也会重建 `subagentDelegation` 项（`mapGrokReplay` 中的 `subagents` 和 `subagentAliases`），与 live 路径共用同一套工具识别函数。
