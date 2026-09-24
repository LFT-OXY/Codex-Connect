# OMP 协议、会话与历史

与 Pi 同构的部分（`#send` 的 id 关联与超时、`#refreshState` 回读确认、`close()` 共享同一个清理 Promise、stdin.end → SIGTERM → SIGKILL 进程树、Prompt 超时直接关进程）行为一致，参见 `.atw/spec/adapter-pi/node/rpc-and-session.md`。下面只列 OMP 不同或独有的部分。

## 启动与帧

- 参数：`ompRpcProcessCommand()` 拼出 `omp --mode rpc-ui [--provider P --model M] [--approval-mode MODE] [--resume F | --fork F]`。环境变量加 `OMP_SKIP_VERSION_CHECK=1`、`OMP_TELEMETRY=0`。
- 握手（`OmpRpcSession.start`）：spawn 成功后，先等待原生 `ready` 帧（超时就是启动失败），再发送 `negotiate_protocol { protocolVersion: 2 }`，这一步的错误被**有意忽略**以兼容旧版，最后 `get_state`。
- 分块帧：`rpc_chunk` 由 `OmpFrameDecoder.push()` 按 `chunkId/index/count/byteLength` 严格重组。分块序列中间插入其他帧，会抛出 “chunk sequence was interrupted”。
- `available_commands_update` 只更新命令目录，不属于 Turn 内容；`ompLiveCommands()` 过滤掉 `source: "builtin"`（这些命令驱动 OMP 自己的 UI 和会话状态），只把 skill 和扩展命令放进 Composer，前缀为 `omp.slash.`。`/compact` 继续由 Adapter 专门处理。

## Turn 与压缩

- 结束信号是 `agent_end` 且 `isTerminal !== false`，随后同样回读 `get_state` 确认不再是 streaming。
- `auto_compaction_start` 和 `compaction_start` 都会进入压缩状态，并暂停 `prompt`/`compact` 的命令超时。另外设置 `compactionTimeoutMs`（默认 300 s）的整体兜底，超时直接 `#fail`。这是 OMP 独有的，Pi 没有。

## 交互（`rpc-ui`）

- `extension_ui_request` 的 `select`/`confirm`/`input`/`editor` 映射为单选、确认、单行文本、多行文本；`select.optionDetails[i].description` 作为第 i 个选项的说明，缺失时兼容旧版。
- OMP 的 `ask` 工具用这些基础交互组合出多问题、多选、“Other”。Adapter **不合并**这些交互，每次只回复当前原生请求的一个字符串。
- 超时回复 `cancelled: true, timedOut: true`，用户取消只回复 `cancelled: true`。超时后是否选默认答案由 OMP 决定。

## 权限模式（`omp-permission-modes.ts`）

- 目录为 `always-ask`、`write`、`yolo`（`dangerous`），默认 `yolo`；`unattended-full-access` 在 create 时映射为 `yolo`。
- 原生只能在启动时通过 `--approval-mode` 设定，所以 `#selectPermissionMode()` 的做法是重启进程：关闭旧 transport → 以 `--resume <sessionFile>` 加新模式启动 → 校验 Session ID 不变。失败时用旧模式再启动一次恢复；恢复也失败就 fault。没有持久化的 Session 文件时返回 `invalidState`。未启动的 Session 只记录选择。
- 已知不一致：`open()` 的 resume/fork/rollback 分支创建 transport 时**不传** `permissionMode`（也不传 `input.environment`），但构造的 Session 仍固定报告 `permissionMode: "yolo"`（约 2483 行）。也就是说，恢复后实际生效的是 OMP 自身的启动默认值，而报告值是 `yolo`。改动这一段时要先决定是透传还是如实报告，不要在此基础上继续叠加假设。

## 子代理（原生）

- `#handleSubagentFrame()` 解析 `subagent_lifecycle`（`started`/`completed`/`failed`/`aborted`）、`subagent_progress`（状态、`recentOutput` 最后一条作为摘要）、`subagent_event`（只触发 transcript 变更）。缺少稳定 ID 或状态非法时判为协议错误。
- 关联键：优先用 `payload.parentToolCallId`，否则用子代理 ID。`detached === true` 映射为 `background`。
- Turn 外到达的子代理帧通过 `onSubagentEvent` 回调交给 Session（`handleTransportEvent`），因此后台子代理在父 Turn 结束后仍能更新。
- `OmpAdapter.subagents.readSnapshot` **总是**以父 Session 文件临时启动一个新 transport，调用 `get_subagent_messages { subagentId }`，把返回的 entries 按父 Session ID 映射成快照，在 `finally` 中关闭。它不像 Pi 那样复用内存中的父 Session。
- 历史快照（`mapOmpSnapshot`）不恢复子代理委派卡片，只有实时路径会产生 `subagentDelegation`。

## 历史、Fork 与回滚

- 有 `sessionFile` 时，`getEntries()` 直接逐行读取 JSONL（`readOmpSessionHistory`）：跳过 `title`、`session` 行，**静默跳过**无法解析的行，并把**最后一条**有效 entry 当作 `leafId`。没有文件时用 `get_messages`，并借助 `get_branch_messages` 的 `entryId` 对齐 user 消息 ID，缺失时用 `omp-message-<index>` 作为占位 ID。
- 文件头：`readOmpSessionHeader()` 在前 64 KiB 中寻找第一条 `type: "session"` 的行（不要求在第一行），与 Pi 只读第一行不同。
- Turn 身份、Checkpoint、Fork 边界（`--fork` 后对下一条 user entry 调用原生 `fork`）、回滚上一轮（`rollbackOmpLastTurn`）都与 Pi 相同。区别在于 OMP 没有“空 fork 未落盘”分支：单轮会话回滚后，如果文件不存在，`verifySessionCwd` 会直接报错。
- 能力声明为 `fork: true`、`forkAcrossCwd: true`、`rollbackLastTurn: true`、`subagents: { observe, readTranscript }`，没有 `autonomousTurns`。
