# Pi RPC 传输与会话

## 进程与帧

- 启动：`piRpcProcessCommand()`（`pi-rpc-session.ts`）拼出 `pi --mode rpc [--provider P --model M] [--thinking L] [--session F | --fork F]`。进程环境固定加 `PI_SKIP_VERSION_CHECK=1`、`PI_TELEMETRY=0`，并经 `withNodeRuntimeOnPath` 补 Node 路径；POSIX 用 `detached: true` 建进程组。
- 帧：一行一个 JSON。`#push()` 按 `\n` 切分，用 `TextDecoder("utf-8", { fatal: true })` 解码；非法 JSON、缺 `type`、stdout 在半帧处结束都走 `#fail(protocolError)`，不做容错跳过。
- 请求：`#send(type, payload)` 生成 `codexhost-<uuid>` 作为 `id`，响应按 `id` 关联；收到未挂起的 `id` 也视为协议错误。失败响应里 `error === "Unknown command: <type>"` 会转成 `PiRpcUnsupportedCommandError`，用于版本降级。
- 超时：普通命令默认 30 s（`commandTimeoutMs`）。`prompt` 超时不会只 reject，而是 `#terminateTimedOutPrompt()` 关闭整个进程并 `onFault`，因为 Prompt 状态已不确定。压缩期间（`compaction_start` 到 `compaction_end`）暂停 `prompt`/`compact` 的超时计时，结束后重新计时。
- 关闭：`close()` 只执行一次 `#stopProcess()`，所有调用方等待同一个 Promise（代码注释：“Closed admission is not proof of process exit”）。顺序是 stdin.end → 等待 → SIGTERM 进程树 → SIGKILL；三轮都超时则抛错。

## Turn 生命周期

- 新建（create）Session 是懒启动：`PiHarnessSession.#ensureTransport()` 在首次需要时才 spawn，随后用 `set_model` / `set_thinking_level` 应用请求的配置并回读确认。resume/fork/rollback 则在 `PiAdapter.open()` 内先启动 transport 再构造 Session（`startedTransport`）。
- `runTurn()` 发送 `prompt`，事件映射为 `PiTurnEvent`：`message_update` 里的 `thinking_delta`/`reasoning_delta`/`thought_delta` 等映射为 reasoning，`text_delta`/`content_block_delta` 映射为 text；`tool_execution_start/update/end` 映射为工具事件。
- 结算：收到 `agent_settled` 后调用 `#confirmSettledTurn()` 回读 `get_state`，若仍是 streaming 则判为协议错误。结算时还有活动工具也判为协议错误。没有文本也没有工具的 Turn 会以 “settled without displayable output” 失败，不会以空成功结束。
- 取消：`abort()` 发 `abort` 命令，并用 `cancelTimeoutMs`（默认 2 s）兜底。超时或失败走 `#terminateFailedCancellation()`：`#fail` 后关闭进程。Adapter 侧 `#cancel` 失败同样把 Session 置为 faulted。
- 自主 Turn（`autonomousTurns.observe: true`）：没有 Host Turn 时，Pi 主动开始的 assistant `message_start`（例如扩展触发）会在 `#startAutonomousTurn()` 里缓存事件，结算后一次性交给 Adapter。这类 Turn 中出现阻塞式 Extension UI（`select/confirm/input/editor`）直接判为协议错误；它与 Host 操作重叠时，Adapter 让 Session 进入 fault（`#handleAutonomousTurn`）。

## 交互

- 原生 `extension_ui_request` 的 `select`、`confirm`、`input`、`editor` 映射为 Host Question；其他 method（如 `setWidget`）不阻塞，交给 `PiSubagentRpc` 或忽略。
- 回复帧是 `extension_ui_response`，内容为 `{ value }`、`{ confirmed }` 或 `{ cancelled: true }` 之一。`#resolveInteraction()` 会校验回复类型与请求 method 一致；先删除挂起项并发出 `interaction.closed`，再写 stdin。
- Turn 结算时仍挂起的交互以 `superseded`（取消时为 `cancelled`）关闭，不能让 UI 永久挂起。

## 命令

- 内置只有 `pi.compact`（`/compact [text]`），走原生 `compact` RPC。`compaction_end.aborted` 映射为 cancelled，`result` 为对象时映射为 succeeded，其余为 failed。
- 实时命令：`get_commands` 返回扩展命令、prompt 模板和 skill，`piLiveCommandCatalog()` 合并后加上 `pi.slash.` 前缀；执行方式是把命令文本作为普通 Prompt 发出（Pi 自己展开）。`PI_EXCLUDED_COMMANDS` 过滤掉 `pi-subagents` 的管理命令（stop/steer/detach/fleet 等）和 Host 内部用的 `subagents-inspect-rpc`。未启动的 Session 只返回内置命令，不会为了列命令而拉起进程。

## Model、Thinking、Permission

- Model Ref：`pi-model-v1.` + base64url(JSON `[provider, id]`)，由 `encodePiModelRef`/`decodePiModelRef` 负责；解码后重新编码必须与原值一致，否则拒绝（不接受非规范编码）。
- Thinking：`get_available_thinking_levels` 不被支持时返回 `null`，此时 `selectThinkingOption: false`；create 请求 Thinking 但原生不支持时返回 `unsupported`。
- Permission Mode：不支持。`open(create)` 带 `permissionModeId` 时返回 `unsupported`，能力声明为 `selectPermissionMode: false`。`--tools`、`--approve` 都不是权限模式（依据见 `docs/harnesses/capability-boundaries.md`）。

## Usage

`getSessionUsage()` 优先调用 `get_session_stats`；不支持时退回 `get_state` 的 context 用量，但要求 sessionId、provider、modelId 与已确认状态一致，否则报错。缓存命中率从 `get_entries` 历史中最近一次 assistant 的数据计算（`latestPiCacheHitRatePercent`），只算一次。

## 文件变更投影

`pi-adapter.ts` 的 `reliableFileChange()`：只对 `fileMutatingKind()` 识别出的 edit/write 类工具生成 `fileChange`。优先使用结果中的 `patch`/`diff`/`unifiedDiff`（必须能解析为单文件补丁）；否则用 `diff` 包根据参数里的 old/new 文本合成补丁，并标记 `diffScope: "fragment"`，因为它不是整文件补丁。工具名经 `normalizeToolName()` 规范为 `bash`/`Read`/`Edit` 等展示名。

## 会话导入与凭据导入

- 会话导入：`PiSessionImportIndex` 与 Pi CLI 的目录规则一致：`PI_CODING_AGENT_SESSION_DIR` 表示平铺目录，否则使用 `PI_CODING_AGENT_DIR`（默认 `~/.pi/agent`）下的 `sessions/` 按 cwd 分目录。列表按文件 stat 指纹缓存。遇到重复的 Session 身份时整体报 `unavailable`（retryable），不要挑一个继续。
- 凭据导入（`pi-credential-imports.ts`）：只支持 npm 安装的 `@earendil-works/pi-coding-agent`。它从可执行文件向上查找 `package.json`，再动态 import Pi 自带的 `FileAuthStorageBackend` 写 `auth.json`，以复用原生文件锁；同时在 `extensions/` 下生成 `codexhost-account-*` 扩展，注册 `openai-codex` / `xai` Provider。增删凭据后 `PiAdapter` 会清空 inspection 缓存。不要自己直接写 `auth.json`。
