# Grok ACP 传输与会话

## 进程与连接（`acp-transport.ts` 的 `GrokAcpTransport`）

- 每个 Transport 只对应一个子进程和一个 Session。`open()` 和 `#ensureInitialized()` 被第二次调用时直接抛错（"cannot be opened twice"/"started twice"）；`inspect()` 不能复用已经打开的 Session。
- 在 POSIX 上用 `detached: true` 让子进程成为进程组组长，Windows 上不设置（`detached: process.platform !== "win32"`）。关闭时依次执行：
  1. 如果对端声明了 `sessionCapabilities.close`，先调用 `closeSession`
  2. `stdin.end()`
  3. 等待 `closeTimeoutMs`（默认 2000ms）
  4. `signalProcessTree(SIGTERM)`，再等待
  5. `SIGKILL`

  `signalProcessTree` 在 POSIX 上执行 `process.kill(-pid)` 并忽略 `ESRCH`，在 Windows 上执行 `taskkill /t /f`。
- 超时：`commandTimeoutMs` 默认 30s，由 `withTimeout` 包住 spawn、initialize、new/load、fork、rewind、delete 和 list。**`runTurn`（prompt）、`compact` 和 `setModel` 没有超时**：长 Turn 和压缩靠 `cancel` 结束，`setModel` 目前没有兜底。
- initialize 要求协商结果等于 SDK 的 `PROTOCOL_VERSION`，否则抛出 `protocolError`。`clientInfo.version` 目前硬编码为 `"0.1.6"`。
- stderr 经 `sanitizeDiagnosticTail` 处理后保存在 `stderrTail`。`inspect()` 失败时，只有在错误本身没有 `diagnostic` 的情况下，才会把它作为 `stderrTail` 附加（`GrokAdapter.inspect`）。

## 错误分类

- `GrokTransportError.kind` 取值：`notInstalled | authenticationRequired | unavailable | protocolError | processExited`。`normalizeError`（`grok-adapter.ts`）把 kind 直接当作 `HarnessError.code`，其中 `notInstalled` 和 `protocolError` 不可重试。
- 启动错误由 `classifyStartupError` 分类：`GrokExecutableError` 归为 `notInstalled`；错误文本含 `auth_required/authentication/not logged in/sign in` 归为 `authenticationRequired`；其余归为 `unavailable`。kiro-cli 的同名函数还额外匹配 `unauthorized`，两者需要各自维护。
- 进程非预期退出时调用 `#fault(processExited)`。Session 收到后转入 `faulted` 状态：结束活动 Turn，发出 `session.faulted`，然后关闭 Transport（`GrokHarnessSession.#fault`）。

## 事件归一化

`transportEvent()` 把 ACP `SessionUpdate` 和 Grok 扩展统一转换成 `GrokTransportEvent`。live 通知和原生 `updates.jsonl` 都走这一个函数，新增事件类型只需要改这里。

- 标准事件：`user/agent_message_chunk`、`agent_thought_chunk`、`tool_call(_update)`、`usage_update`。
- Grok 扩展事件（写在 `sessionUpdate` 字段里）：
  - `turn_completed`（`prompt_id` 作为 `nativeTurnKey`）
  - `rewind_marker`
  - `auto_compact_{started,completed,failed,cancelled}`
  - `subagent_spawned/finished`
- 扩展通知 `_x.ai/session/update` 和 `x.ai/session_notification`（`GROK_SESSION_UPDATE_EXTENSION_METHODS`）都会走 `#handleUpdate`。
- 工具名优先取 `update.name`，其次取 `_meta["x.ai/tool"].name`（`acpToolName`）。子代理识别依赖这个工具名。
- `available_commands_update` 只更新命令目录，不进入 Turn 或 replay。事件分发优先级：replay 缓冲 > 活动 prompt > 活动 compact。

## 原生 Session 目录

- 路径：`$GROK_HOME|~/.grok/sessions/<encodeURIComponent(resolve(cwd))>/<sessionId>/`（`grokNativeSessionDirectory`）。目录下的 `updates.jsonl` 是历史，`signals.json` 保存 Usage 信号，`summary.json` 保存 cwd 和 `source_workspace_dir`。
- `locateGrokNativeSession` 扫描所有 cwd 目录，找出含该 sessionId 的 `summary.json`。**只有唯一匹配时才返回结果**，多处命中时返回 null。Fork、Rewind 和子代理 transcript 都依赖它定位源 cwd。
- `readGrokNativeHistory`：文件不存在时返回 `[]`；只要有一行不是合法 JSON，就整体抛出 `protocolError`，不跳过；`params.sessionId` 不匹配的行会被丢弃。

## 模型与 Thinking（`grok-models.ts`）

- 目录的来源有两个：session 响应里的 `models`，以及 initialize 响应里的 `_meta.modelState`，前者优先（`GrokAdapter.open`）。Thinking 选项来自每个模型的 `_meta.reasoningEfforts`，上下文窗口来自 `_meta.totalContextTokens`。`currentModelId` 不在目录中时，整个目录视为无效。
- 切换 Model 或 Thinking 都通过 `session/set_model { modelId, reasoningEffort? }` 完成。只有响应中 `_meta.model.Ok` 是非空字符串才算成功，否则抛出 `protocolError`（`setModel`）。`#configure` 用 `#configuring` 互斥，但允许在 prompt 运行期间切换（测试 "forwards Model and Thinking selection while a prompt is running"）。
- 创建 Session 时，请求的 Model 通过 `--model` 启动参数传入；如果与会话报告的当前值不一致，再补一次 `setModel`。Fork 和 Rewind 后会恢复源 Session 的 Model 和 Thinking；如果新目录里没有该值，直接失败，不替换成其他值。

## 权限模式与审批

- 原生模式有 `ask`（默认）、`auto` 和 `always-approve`（dangerous），通过 new/load 的 `_meta: { yoloMode, autoMode }` 传入（`grokPermissionModeSessionMeta`）。`executionPolicy: "unattended-full-access"` 映射为 `always-approve`。
- `permissionModeScope: "atCreate"`：`permissionMode.select` 会先校验模式 ID，然后始终返回 `invalidRequest`（"fixed at Session creation"）。
- 审批选项投影（`projectGrokPermissionOptions`）：缺少 `allow_once` 或 `reject_once` 时不弹窗，直接返回 cancelled；optionId 为 `always-allow` 或 `enable-always-approve` 的 `allow_always` 会**被过滤掉**，因为它们会切换全局模式，不属于单次授权。取消、结束或关闭 Turn 时，所有挂起的审批都以 `cancelled` 结束。

## 命令与 `/compact`

- 静态命令只有 `grok.compact`。其他命令来自 `available_commands_update`，经 `grokLiveCommands` 转换：带 `SKILL.md` 路径或 `qualifiedName` 的条目标记为 skill，用 `/name args` 作为 prompt 文本发送。通用排除规则由 `mergeLiveHarnessCommands` 处理。
- 手动压缩先调用 `x.ai/compact_conversation`，遇到 Method Not Found 时回退到 `_x.ai/compact_conversation`。它会生成一个临时 Turn，不带 `nativeTurnRef`。终态以原生 `auto_compact_*` 事件为准，优先于 RPC 返回值（测试 "uses the native terminal compact outcome over the RPC result"）。参数只接受 `text` 字符串。
- 自动压缩：Turn 中途出现 `auto_compact_started` 时，先结束当前 reasoning 和 agent 项，再插入 `contextCompaction` 项。压缩失败只把该项标记为失败，不结束 Turn。成功时 `usageFromCompact(tokensAfter, window)` 会更新上下文用量。

## Usage、Credits 与凭证

- `costUsdTicks` 以 1 USD = 10^10 ticks 换算（`grok-usage.ts`）。Turn 结束时，用 `sessionUsageFromHistory` 汇总所有 `turn_completed.usage`；resume 时再合并 `signals.json`（`usageFromSignals`）。
- Credits（`grok-credits.ts`）是账户级遥测：读取 `auth.json` 中 `https://auth.x.ai` 签发的 token，向 `cli-chat-proxy.grok.com/v1/billing` 发请求。网络错误或 JSON 解析失败时返回 null，不能当作 0% 用量（测试 "does not turn network errors or invalid JSON into zero usage"）。失败时保留上一份成功快照，不写入 Session Usage。
- `readGrokCredentials`：只要设置了 `XAI_API_KEY`、`GROK_API_KEY` 或 `GROK_TOKEN` 中任意一个，就不导出凭证；否则只导出固定 xAI OAuth client 的凭证，`expires` 提前 5 分钟。

## 工具输出与媒体

- `bash/run_terminal_command/shell/cursor_shell` 投影为 `commandExecution`，其余工具投影为通用 tool 项。输出优先取 ACP text content，再取 typed `rawOutput`。上限 `DEFAULT_GROK_TOOL_OUTPUT_LIMIT = 64_000`（`grok-tool-output.ts`）。
- fileChange 只从状态为 `completed` 的工具的 ACP Diff content 生成（`#completeTool` → `projectGrokFileChanges`）。以下情况都会 fail closed：格式错误、无实际变更、重复、超过 4MB 或超过 32 个文件。`oldText === null` 是判断新增文件的唯一信号。
- 助手文本经 `rewriteLocalMediaMarkdown` 处理：把指向本地媒体的相对路径或反引号路径改写成绝对路径的 Markdown 图片，查找根目录依次为 cwd、Session 目录及其 `videos/`、`images/` 子目录、`~/Downloads`。流式输出时使用 `holdIncomplete`，把尚未闭合的片段留到下一次处理，保证已输出前缀不变。围栏代码块和普通行内代码不改写。
