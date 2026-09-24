# 历史、Fork、回滚与子代理

## 历史是 codexhost 的 sidecar，不是原生回放

agy headless 不向客户端提供已保存的助手历史，所以 `history.ts#AntigravityHistory` 自己保存一份 Host 投影：

- 路径：`$CODEXHOST_DATA_DIR`（默认 `~/.codexhost`）下的 `antigravity-history/<threadId>.json`。`threadId` 取自 env `CODEXHOST_THREAD_ID`，没有时退回 `CODEXHOST_DELEGATION_THREAD_ID`，并且必须匹配 `/^[A-Za-z0-9._-]+$/`。拿不到 threadId 时不落盘（`historyPath` 返回 `null`）。
- 格式：用 zod `historySchema`（`strictObject`，`formatVersion: 1`）校验。内容包括 `nativeSessionId`、`turns[]`，以及 `model`、`thinkingOptionId`。Item 的 schema 是本文件自己的 `hostItemSchema`，只覆盖本 Adapter 会产出的 Item 类型。**新增 Item 类型时必须同步扩展这里**，否则 sidecar 解析会失败，历史会整体丢弃。
- 写入：`#queueWrite` 串行执行，先写临时文件再 `rename`，目录权限 `0o700`，文件权限 `0o600`。`close()` 前会 `flush()`。
- sidecar 缺失、损坏或 `nativeSessionId` 不匹配时，返回空历史（注释写明 “cannot safely be treated as Native history”）。如果 Host 提供了 `knownTurnRefs`，就生成 `outcome: { status: "unknown" }` 的占位 Turn，不编造内容（测试 `falls back to known Native Turn placeholders when no sidecar exists`）。
- `bindNativeSession` 遇到不同的 nativeSessionId 时会清空 turns。`append` 按 `nativeTurnKey` 覆盖或追加。
- Turn 与 Checkpoint 的 key 都是 `turn:<result.num_turns>`（`#handleResult`）。没有 `num_turns` 时退回 `turn:<历史长度+1>`。

## Fork 与回滚：复制 agy 私有存储

`fork.ts#forkAntigravitySession` 和 `rollback.ts#rollbackAntigravityLastTurn` 是两份结构几乎相同的独立实现，改其中一份时要同步检查另一份。二者都**生成一个新的 nativeSessionId（`randomUUID()`）**，不会原地修改源会话：

1. 校验 `sourceRef.harnessId`，不匹配时返回 `invalidRequest`。Fork 还会校验 checkpoint 是否属于源会话，不属于时返回 `checkpointNotFound`。源会话 `isActive` 时返回 `sessionBusy`。
2. 源历史优先取内存中的会话，其次用 `AntigravityHistory.findByNativeSessionId` 扫描 sidecar 目录。都找不到时返回 `sessionNotFound`。回滚遇到 0 个 Turn 时返回 `invalidState`。
3. 截取要保留的 Turn（Fork 截到 checkpoint 所在 Turn，回滚去掉最后一个 Turn），把其中的 `nativeSessionId` 改写成新 ID，然后用 `AntigravityHistory.createDerived` 写出新的 sidecar。
4. `cloneNativeConversationDb` 把 `~/.gemini/antigravity-cli/conversations/<id>.db` 复制为新 ID，用 `node:sqlite` 执行 `UPDATE trajectory_meta SET cascade_id`，再按 `step_type = 14`（每个 Turn 的 user_input 步骤）裁剪 `steps` 以及 `gen_metadata` 等表，最后在 `conversation_summaries.db` 里注册新会话。`copyNativeBrainDirIfExists` 复制 `brain/<id>`，但排除 `.system_generated`。
5. 模型、Thinking、权限模式都从源会话继承。`fork.test.ts`、`rollback.test.ts`、`adversarial-fork-rollback.test.ts` 第 8 组覆盖了这一点。

已知风险（照实记录，修改时不要扩大）：

- 以上都依赖 agy 私有的 SQLite 表结构和 `step_type = 14` 这个魔数，并没有公开的 Fork 接口。每个 SQL 语句都包在空的 `catch {}` 里；`Promise.all` 的复制结果（`boolean`）也被忽略。因此原生 DB 复制失败时，Fork 仍会返回成功，下一个 Turn 带上 `--conversation <新ID>` 后，可能在 `init` 阶段因 “resumed a different Conversation” 以 `sessionNotFound` 失败。改进时应该让复制失败显式返回错误，而不是继续吞掉。
- `node:sqlite` 通过动态 `import` 加载，加载失败时返回 `false`，同样会被忽略。
- `copyNativeConversationDbIfExists` 只是 `cloneNativeConversationDb` 的别名。

## 子代理

- 原生证据（`docs/harnesses/antigravity/antigravity-subagents.md`）：`invoke_subagent` 会产生 `step_type: "subagent"`，其中带有 `subagent_info.subagents[]`，包括 `conversation_id`、`type_name`、`role`、`initial_prompt`。**DONE 只表示 spawn 调用结束，不表示子代理结束**，子代理的运行状态要另外通过 `GetCascadeTrajectory` 的 `CASCADE_RUN_STATUS_RUNNING/IDLE` 查询。
- `subagents.ts#AntigravitySubagents` 用 zod `infoSchema` 解析这些信息（最多 32 个子代理，子代理 ID 必须是 UUID），并产出通用契约 `subagentDelegation`、`subagent.state.changed`、`subagent.transcript.changed`。不新增任何 Antigravity 专用的 Renderer 或 Host RPC。
- 超时语义：父 Turn 结束后，每个仍在运行的子代理有 30 秒窗口（`DEFAULT_SUBAGENT_OBSERVATION_TIMEOUT_MS`，可通过 `subagentObservationTimeoutMs` 配置，但必须是正的有限数）。每次观察到有效的 running 状态就续期；持续观察不到时标记为 `interrupted`，并说明完成情况未经确认。**RPC 失败不等于完成**（测试 `does not treat an RPC failure as child success`）。transcript 读得慢不会让有效状态过期（测试 `does not expire a valid running status while its transcript read is slow`）。
- 取消：先对父会话、再对每个运行中的子代理调用 `CancelCascadeInvocation`，然后再取一次状态确认。无法确认时如实报告中断，不声称已经成功取消。
- transcript（`subagent-transcript.ts#readSubagentTranscript`）：
  - 只读固定位置 `~/.gemini/antigravity-cli/brain/<childId>/.system_generated/logs/transcript.jsonl`，并用 `realpath` 校验没有被重定向。**绝不读取事件中 `log_uri` 指向的路径**（代码注释写明这一点）。
  - 文件上限 8 MiB。末尾不完整的 JSON 行留到下次再读；文件中间出现损坏时返回 `protocolError`。
  - 子代理与父会话的归属关系通过 `trajectory.metadata.parentConversationId` 校验。`AntigravityAdapter.subagents.readSnapshot` 还会先确认该子代理 ID 出现在父会话的状态或历史中。
- 只投影用户输入、可见回复和工具输出，不把 thinking 或注入的系统元数据投影成消息。Item 和 Turn 的 ID 由原生子代理身份派生，跨重启保持稳定。

## 验证

```bash
npx vitest run --config tests/vitest.config.js packages/adapters/antigravity/test/history.test.ts packages/adapters/antigravity/test/fork.test.ts packages/adapters/antigravity/test/rollback.test.ts packages/adapters/antigravity/test/adversarial-fork-rollback.test.ts packages/adapters/antigravity/test/subagents.test.ts
```

要注意 home 目录的隔离方式：原生路径函数（`nativeConversationDbPath`、`nativeBrainDirPath`）的 home 参数默认取 `os.homedir()`，而 `forkAntigravitySession` 和 `rollbackAntigravityLastTurn` 调用它们时**没有传入 home**。因此，给 Adapter 或会话传入 `environment.HOME`/`USERPROFILE` **不会**改变这两个路径。例如 `rollback.test.ts` 的 `copies native sqlite db file on rollback if present` 走 Adapter 路径，实际访问的是真实 `~/.gemini` 下并不存在的 `conv-rb-db.db`，复制失败后被静默忽略，所以只断言了新 nativeRef 存在。只有直接调用这些函数并传入 fakeHome 的用例真正隔离了 home，例如 `fork.test.ts` 的 `copies native conversation sqlite db file if present`，以及 `rollback.test.ts` 的 `accurately prunes steps based on turn boundaries in native sqlite db`。需要验证 SQLite 复制或裁剪行为时，直接调用这些函数并显式传入临时 home。
