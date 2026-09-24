# Claude Code：SDK 会话、历史与配置

> 通用约定见 `.atw/spec/adapters/node/index.md`。

## SDK 调用（`sdk-transport.ts#start`）

每个 Session 对应一个长生命周期的 `query()`。`prompt` 是 `PushableInput<SDKUserMessage>`，多轮输入都推入同一个流。关键选项：

```ts
...(openMode === "resume" ? { resume: sessionId } : { sessionId }),
pathToClaudeCodeExecutable: executable,        // 来自 resolveClaudeCodeExecutable
settingSources: ["user"], permissionMode, canUseTool, persistSession: true,
includePartialMessages: true, forwardSubagentText: true,
env: withNodeRuntimeOnPath({ ...env, CLAUDE_CODE_ENTRYPOINT: "codexhost-sdk", CLAUDE_AGENT_SDK_CLIENT_APP }),
spawnClaudeCodeProcess: (o) => this.#spawn(o),
```

- **create 时由 Adapter 预先生成 sessionId**（`dependencies.randomUUID()`，通过 SDK 的 `sessionId` 选项传入），因此 `nativeRef` 在打开时就能确定；resume 时传 `resume`。
- `CLAUDE_CODE_ENTRYPOINT = "codexhost-sdk"`：Claude 会在原生会话选择器里隐藏通用 SDK 入口，用这个值才能让 codexhost 的会话在原生 CLI 中可见（commit `e58a19c1`）。不要改回默认值。
- `settingSources` 只包含 `"user"`，query 和 `ClaudeSdkModelInspector` 两处一致。要加入 project/local 源时，先核对 SDK 对这些源的加载语义，并单独评估影响。
- Thinking 开启时固定使用 `{ type: "adaptive", display: "summarized" }`：默认的 adaptive thinking 只流式输出空文本，不会产生 Reasoning Item（见代码注释）。
- `allowDangerouslySkipPermissions` 只在非 root 用户时传入（`allowsDangerouslySkipPermissions()` 检查 `getuid() !== 0`）。
- **不要打包 SDK 自带的平台 CLI**：`build-plugin.mjs` 会拒绝 `node_modules/@anthropic-ai/claude-agent-sdk-*` 输入。实际运行的永远是用户本机发现到的 `claude`。

## 进程与环境

- `#spawn` 在 Unix 上 `detached: true`，建立独立进程组。关闭时由 `process-fence.ts#closeClaudeProcessGroup` 向整个组发 SIGTERM，超时后发 SIGKILL，确认进程组消失。即使包装进程已退出也要发信号，因为组里可能还有 CLI 或 MCP 子进程。Windows 使用 `taskkill /PID <pid> /T /F`；根进程已退出时报错，因为无法再确认进程树状态。
- 默认超时（`claude-code-adapter.ts`）：close 7s、cancel 2s、工具输出上限 64 000 字符、continuation 静默期 2s。构造函数用 `RangeError` 拒绝非正整数的超时值。
- 硬取消后，活动 Turn 和它的 Transport 在 close 成功前一直属于这个 Session，迟到的原生终态不能绕过这个等待。关闭失败时 Session 进入 fault，此后不能开启新 Turn，也不能确认历史替换（edit-recovery 文档）。
- `plugin.ts` 在工厂里调用 `withUserShellEnvironment`：GUI 进程不会加载 shell 初始化文件，所以用登录 shell `-ilc` 取一次环境（3s 超时，缓存 key 为 platform + shell + HOME），**只补充缺失的变量，不覆盖 Host 已有的值**。win32 或没有 HOME 时跳过。结果不持久化，也不写日志。

## Turn、Segment 与后台 Subagent

- Turn 的 `nativeTurnKey` 是调用方为用户消息分配的 UUID，Claude 会在 transcript 中原样保留它。Item ID 由 `claudeTranscriptItemId(nativeTurnKey, kind, ordinal)` 派生（`claude-item-v2-…`），因此实时流和之后读取的历史指向同一个 Renderer Item。改 ordinal 计数时，实时和历史两边必须一起改。
- Claude 可能在一个 Turn 里产生多个 Segment。后台 Subagent 的 task notification 只说明它已停止，Root 对它的后续回复在之后的 Segment 里到达，而且无法从流里知道还剩几个 Segment（`background-occupancy.ts` 注释）。因此用户 Turn 会保持 `held`，直到原生会话超过 `continuationQuiescenceMs` 不再开启新 Segment。
- 没有活动 Turn 时产生的原生输出按自主 Turn 处理，发出 `turn.autonomous.started`。Thread 级的事件（如后台 Subagent 结束）不能依赖活动 Turn 才发布。
- `canUseTool` 在没有活动 Turn、requestId/toolUseID 缺失或重复、signal 已 abort 时直接返回 deny。三类请求：`AskUserQuestion` → Host Question；`ExitPlanMode` → 计划审批（`plan-review.ts`）；其余 → Host Approval（标题最长 120 字符、描述最长 500 字符，只有 SDK 提供的 suggestions 才会显示会话级或永久授权选项）。

## 历史（transcript）

- 位置：`${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<cwd 中非字母数字字符替换为 ->/<sessionId>.jsonl`。预期路径不存在时，扫描 `projects/` 下的所有目录（`claude-transcript.ts#findTranscript`）。
- **不要改用 SDK 的 `getSessionMessages()` 读主会话**：它只沿一条 `parentUuid` 分支读取，而 Claude 可能把后续 prompt 挂在上一轮 assistant 终态之前的 system 记录下，导致漏掉 assistant 消息。`readClaudeTranscript` 按文件顺序读取全部 `user` / `assistant` 记录。Subagent 历史仍然使用 SDK 的 `getSubagentMessages`。
- 快照投影 `mapClaudeSnapshot`：每条人类用户消息开启一个 Turn，`nativeTurnKey = user.uuid`；checkpoint 是该 Turn 最后一条 assistant 消息或中断记录的 uuid。原生中断标记（`[Request interrupted by user…]`）归属于对应的人类 prompt。
- transcript 是异步写入的。`readSnapshot` 会在 closeTimeout 内重试，直到已知的 message id 都已落盘；超时仍未落盘时返回 retryable 的 `sessionBusy`，不返回缺少内容的历史。

## Fork 与 Rollback（`claude-fork.ts`）

- Fork 调用 SDK 的 `forkSession(sourceSessionId, { dir: cwd, upToMessageId: checkpointId })`，然后按通用 spec 的方式校验前缀、校验源会话不变、检查新旧会话 ID 不重叠。任一不满足时，调用 `deleteSession` 删除派生会话，返回 `protocolError`。
- 源会话的 `getSessionInfo().cwd` 与目标 cwd 不同时，返回 `unsupported`（`forkAcrossCwd: false`）。
- Rollback 在源会话有 ≥2 个 Turn 时，fork 到倒数第二个 Turn 的 checkpoint；只有 1 个 Turn 时，用 `ClaudePendingSessions.create` 在 `${CLAUDE_CONFIG_DIR}/codexhost/pending-sessions/<uuid>` 写入空会话预留（`locator: { pendingSession: 1 }`，同时保存 Model/Thinking/Permission），之后以 `openMode: "create"` 打开。预留文件带独占的创建 claim。**transcript 缺失不能被推断成空会话**，也不要为了“修复”而删除预留元数据。
- 源会话有活动操作时，rollback 返回 `sessionBusy`（`blocksRollback` / `prepareRollback`）。

## Model、Thinking、Permission、命令

- Model Ref：`claude-model-v1.` + base64url；解码得到 `"default"` 时返回 `undefined`，表示交给 SDK 默认。目录来自 SDK 的模型列表，与用户 settings 的 `modelPicker.options` / `replaceBuiltInOptions` 合并（`model-catalog.ts`）。配置格式无效时忽略，不能清空 SDK 模型。
- Thinking 是固定列表 `off / auto / low / medium / high / xhigh / max`，默认 `auto`。`off` 映射为 `{ type: "disabled" }`，其余是 adaptive + effort。
- Permission Mode：`plan / default / acceptEdits / auto / bypassPermissions`（排除 SDK 的 `dontAsk`）。只有当至少一个 Model 声明 `supportsAutoMode: true` 时，目录里才出现 `auto`。`unattended-full-access` 映射为 `auto`。模式变化以 SDK 的 `system/init|status` 消息为准，批准或拒绝计划后 Adapter 不会主动调用 `setPermissionMode`。
- 静态命令 `claude.compact` / `claude.init` / `claude.recap` 分别发送 `/compact [指令]`、`/init`、`/recap`。启动后从 `initializationResult().commands` 读取实时 slash 命令和 skill（`liveCommandCatalog = true`）。
- 账号：`inspectAccount()` 通过 inspector 读取。`credits()` 把 `rate_limit_event` 推送的 5 小时和 7 天窗口投影成 `AccountCreditsSnapshot`。它不是正式的 Adapter 字段，Host 用结构检查识别，不要把它当成公共契约去扩展。

## 已知坑

- 懒启动：create 和 resume 都要到第一个 Turn（或命令）才启动 `query()`。打开后不发消息就关闭，不会产生任何 Transport（测试 “opens and closes unused Sessions without creating a Transport”，“defers resumed Query startup until the next Turn and applies the final configuration”）。
- 实时路径和历史路径必须对同一段原生内容给出相同的 Item 身份和结果，否则 Desktop 会重复显示（测试 “uses one Item identity for a live response and its native history snapshot”）。
- Windows 进程树回收还需要在目标平台验证（edit-recovery 文档）。
