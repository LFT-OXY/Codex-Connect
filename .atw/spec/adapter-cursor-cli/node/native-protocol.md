# 原生协议、配置与投影

## Transport（`src/transport.ts` `CursorTransport`）

- 启动：`cursorInvocation(env, command)` 默认参数 `["acp"]`；POSIX 用 `detached: true` 建独立进程组，Windows 不 detached。`src/command.ts` 在 Windows 上把 `.cmd/.ps1` 启动器解析为 `versions/<ver>/node.exe index.js` 直接运行，避免中间 cmd/PowerShell 进程死后留下孤儿 ACP 进程；找不到 bundle 就抛错，不回退到 shell。
- 握手：`initialize` 带 `clientCapabilities._meta.parameterizedModelPicker = true`，要求 `protocolVersion === 1`；随后 `authenticate({ methodId: "cursor_login" })` 复用用户已有登录，Adapter 从不发起登录也不读凭据。`clientInfo.version` 硬编码为 `"0.6.2"`，与发布版本无关。
- 生命周期是单次的：`prepare()` 只启动/认证（可被 Fork 提前调用，与 CLI 事务并行），`open(sessionId?)` 只能调用一次（`#opened`），有 `sessionId` 且 `agentCapabilities.loadSession` 为真时走 `loadSession`，否则 `newSession`。要重开就新建 transport。
- 超时：`#bounded()` 默认 30s（`timeoutMs` 可覆盖），超时会 `close()` 整个 transport。这是有意的"毒化"：迟到的配置响应不能影响下一轮（测试 `poisons a timed-out configuration so a late response cannot affect another turn`）。`prompt()` 没有墙钟超时，只由 cancel/close/进程退出结束。
- 故障：进程 `error`/`exit` 通过 `#failed` promise 让所有进行中的请求立即失败；`CursorSession.#run` 捕获后发 `session.faulted` 并关闭会话（测试 `faults and closes a dead ACP session instead of accepting further turns`）。
- 关闭：`stdin.end()` → 等 500ms → POSIX `process.kill(-pid, "SIGKILL")` / Windows `taskkill /PID /T /F`（2s 上限）→ 再等 2s 退出。与 grok 的 SIGTERM→SIGKILL 两段式、kiro 的直接进程组 SIGKILL、kimi-code 只结束直接子进程都不同。
- 回调：`sessionUpdate` 过滤非本会话通知；`available_commands_update` 只写入 `transport.availableCommands`，不进入 turn 投影；无活动 prompt 时通知进入 `replay`（上限 100,000 条，超出抛错），这是 `session/load` 历史回放的来源。没有活动回调时 `requestPermission` / `extMethod` 一律回 `cancelled`。
- `stderr` 只 `resume()` 丢弃，不进入错误或事件。`cursorError()`（`src/adapter.ts`）按消息正则把错误映射为 `notInstalled` / `authenticationRequired` / `processExited` / `protocolError`，改错误文案时要保证这些关键词仍能命中。

## 模型、Thinking 与执行模式（`src/models.ts`、`src/thinking.ts`）

- 模型目录来自 `session/new|load` 的 `configOptions` 中 `id === "model"` 的 select；每个模型各自的参数来自私有扩展 `cursor/list_available_models`，经 `parseCursorNativeModels` 边界校验。旧版 CLI 返回 JSON-RPC `-32601` 时退回标准配置，不报 Thinking。
- Host Model Ref 是不透明的 `cursor.<base64url(nativeId)>`；`cursorConfiguredModelRef` 把 `category === "model_config"` 的非 Thinking 参数（如 `context`、`fast`）编码进 ref（`model[k=v,...]`），使 Host 重启后能恢复，不依赖 Cursor 账户级偏好。旧的方括号 ref 在 `cursorModelSelection` 中逐项对原生元数据复核，任何参数不可选就报错，不静默丢弃。
- Thinking：`category === "thought_level"` 的所有 select 参数做笛卡尔积（上限 64 个组合，超出返回空），每个组合 ID 为 `cursor.<base64url(JSON 值对)>`。不要只取 effort 而丢掉 thinking 开关。`CURSOR_CAPABILITIES.configuration.selectThinkingOption` 静态为 `false`，实际值由 `cursorCapabilities(info)` 按目录计算，读能力时用后者。
- 执行模式 `CURSOR_MODES`：`agent`（默认）/ `plan` / `ask`，是原生模式，不是伪造的审批级别；`permissionModeScope: "live"`。
- 写入流程（`CursorSession.execute` 配置分支）：逐个 `[configId, value]` 写入；已等于当前值则跳过；每次响应后检查响应里的 `currentValue`，不一致抛 "Cursor did not confirm configuration selection"；每次确认后整体替换 `info.configOptions`（选模型可能改变其他参数）、清除旧 Thinking 再重算，并发 `session.state.changed`。部分失败时保留已确认的状态（测试 `reports the last confirmed state if the second parameter write fails`）。
- 活动 turn 期间只允许 `model.select`、`thinking.select`，其他命令返回 `sessionBusy`。
- Inspection：`inspect()` 开一个空 ACP 会话读目录，按 cwd 缓存成功与失败结果，无过期，只在 `refresh` 时重查，并发请求复用进行中的 promise。

## 交互（`src/interactions.ts` `CursorInteractions`）

- `requestPermission` → Host `approval`，`allow_once/allow_always/其他` 映射为 `allowOnce/allowAlways/deny`，actionId 直接用原生 `optionId`。
- `cursor/create_plan` → 两个动作的 approval，回原生 `accepted/rejected/cancelled`。
- `cursor/ask_question` → Host `question`（choice，`allowOther: false`），结构校验不通过直接抛错。
- `cursor/task` 先交给 `CursorSubagents.extension`，其余未知扩展返回 `{ outcome: "rejected", reason: ... }`。
- 回应用 `validateHostInteractionResponse` 校验；`cancel()` 在 turn 结束、取消、关闭时关闭全部挂起交互并以 `cancelled` 回原生。

## 事件投影（`src/projection.ts` `CursorTurnOutput`）

- text/thought chunk 合并为 `agentMessage` / `reasoning` Item，类型切换时结束上一个；Item ID 为 `cursor-<turnId>-<n>`。
- `tool_call(_update)`：`content` 非空时整体替换输出（不是累加），输出截断到 100,000 字符。只有工具 `completed` 后才额外发一个 `fileChange` Item；pending/失败/取消不产生文件变更。
- fileChange 规则：`oldText == null` 为新增；整份 patch 放不进 100,000 字符预算就整份省略，不截断；`createTwoFilesPatch` 超时 100ms。已知坑：CLI 2026.09.10 新文件 diffString 回退会把 `-- /dev/null` 放进 `oldText`、`++ b/<path>` 放进 `newText`，代码识别后跳过，不从当前文件"修复"。
- turn 结束时未完成的工具：成功 turn 下标记为 `protocolError`（"Cursor did not report tool completion"），否则继承 turn outcome。

## 子代理（`src/subagents.ts` `CursorSubagents`）

- 通过 `rawInput._toolName === "task"` 识别原生 Task，投影为 `subagentDelegation` Item；`pending`/`in_progress` 分别映射 `pending`/`running`。
- `session/load` 会把 toolCallId 改写为 `replay-N-M`，所以子代理句柄是 `task.v1.<turnIndex>.<taskIndex>.<sha256(description,prompt) 前 24 位>`（`cursorTaskHandle` / `cursorTaskAddress`），不是原生 ID，也不是伪造的子会话。
- `cursor/task` 扩展只在对应 Task 已有终态时返回 `completed`，并补上最终 model；否则 `rejected`。后台 Task（`rawOutput.isBackground`）的"启动成功"不等于完成，父 turn 结束时以 `interrupted` 收尾。
- 子视图只包含真实 prompt 和 ACP 给出的完整文本结果；ACP 不暴露子代理内部步骤，不要合成。卡片摘要截 2,000 字符。能力声明 `subagents: { observe: true, readTranscript: false }`。
- `CursorAdapter.subagents.readSnapshot`：活动会话有就直接用；否则开一个 `delegation: false, loadModelCatalog: false` 的回放 transport，并在前后比较原生 turn 序列，变化即失败。

## Slash 命令（`src/slash-commands.ts`）

- 只接受会话最近一次 `available_commands_update` 公布的命令；`update-cli-config` 被排除（会改写 Cursor 自身配置）。Cursor 不区分 skill 与命令，全部按 `"command"` 走 `isExcludedLiveCommand`。
- 执行方式是把 `/<name> <text>` 作为普通 `turn.start` 提交，由原生解析。`input === null` 或 `copy-request-id` 视为无参数。
- `CURSOR_COMMAND_CATALOG` 是 Host 不开会话时读取的静态目录，仅含 `copy-request-id`；`/copy-request-id` 不产生原生 user turn，`#run` 对其特判允许没有 `nativeTurnRef`。

## 向外委派 MCP（`src/delegation-bridge.ts`）

- 只有四个环境变量 `CODEXHOST_CLI_PATH`（必须绝对路径）、`CODEXHOST_RUNTIME_ENDPOINT`、`CODEXHOST_RUNTIME_TOKEN`、`CODEXHOST_THREAD_ID` 齐全，且 `initialize` 报告 `mcpCapabilities.http` 时才创建；通过 `mcpServers` 注入 `session/new|load`，不改用户的全局 MCP 或项目规则。
- 监听 `127.0.0.1:0`，每会话随机 Bearer token，拒绝带 `Origin` 或 token 不符的请求。工具：`harness_list`、`harness_inspect`、`delegate_start`、`thread_send`、`thread_read`、`thread_wait`、`thread_cancel`，用 `execFile`（无 shell）调用 Host CLI，65s 超时、1 MiB 输出，失败输出先替换 runtime token 再 `sanitizeDiagnosticTail`。
- inspection、历史回放、子代理回放都传 `delegation: false`；只有可写会话 `delegation: true`。
