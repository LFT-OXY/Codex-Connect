# ACP 传输、配置与交互

## 进程与连接（`src/acp-transport.ts#KiroAcpTransport`）

- 每个 Transport 只对应一个 `kiro-cli acp` 子进程和一个 Session。`open()` 不能调用两次；`inspect()` 不能复用已打开的 Session。
- 非 Windows 平台以 `detached: true` 启动子进程，让它自成进程组；`signalProcessTree` 在 POSIX 上执行 `process.kill(-pid)`，并忽略 `ESRCH`；Windows 上改用 `taskkill /t /f`。
- `close()` 的顺序：取消所有配置等待，调用 `stdin.end()`，等待 `closeTimeoutMs`（默认 2s）。进程仍未退出时，直接向进程组发送 `SIGKILL`，再等 1s。这里**没有 SIGTERM 这一步**，Grok 的实现是先 SIGTERM 再 SIGKILL。`docs/proposals/external-harness-idle-unload-proposal.md` 把 Grok、Hermes、Kiro 统一描述成“超时 SIGTERM 或 SIGKILL”，其中 Kiro 只会走 SIGKILL。
- `initialize` 发送的 `clientCapabilities._meta.kiro` 为 `{ userInput, requirementsAnalysis, specPhaseCheckpoints }`，`clientInfo.version` 写死为 `"0.1.6"`。协商得到的版本不等于 `PROTOCOL_VERSION` 时，按 `protocolError` 处理。
- stderr 经 `sanitizeDiagnosticTail` 处理后保存在 `stderrTail`。进程意外退出时（未处于关闭流程）调用 `onFault(processExited)`，`KiroSession.fault()` 随后关闭 Session，并发出 `session.faulted`。
- 启动错误统一交给 `classifyStartupError` 分类：`KiroExecutableError` 归为 `notInstalled`；错误文本含 auth、sign in、unauthorized 等关键词时归为 `authenticationRequired`；其余归为 `unavailable`。

## 超时即 fault

- 所有 RPC 都经过 `withTimeout`（默认 `commandTimeoutMs = 30_000`），超时抛出 `KiroRequestTimeoutError`（`KiroTransportError` 的子类，kind 为 `unavailable`）。
- **配置写入超时的处理与普通失败不同**。`#setConfigOptionOnSession` 捕获到 `KiroRequestTimeoutError` 后，会先 `#fault()`，再 `close()`。本地超时撤销不了原生侧已经完成的写入，所以不能继续用可能过期的配置跑回合。RPC 被显式拒绝时只返回操作失败，Session 保持可用。测试见 `test/acp-session-lifecycle.test.ts` 中的 “faults and blocks sends after an unconfirmed $type write”。
- 迟到的回复不能复活已关闭的 Session，也不能把请求的值当作已确认发布出去。

## 配置写入必须经原生确认

- 写入 Model、`effortLevel`、`autopilot` 时，都要经过 `models.ts#confirmedKiroConfig` 检查：响应中的 `configOptions[id].currentValue` 必须等于请求值，否则抛错。`KiroSession#applyThinking` 还会再调用一次 `kiroThinkingState` 确认 effort 值生效。
- 异步 Model 目录的坑出现在 Kiro 2.21.2：Fork 或加载完成后，Model 写入可能已经成功，但返回的 `configOptions` 里暂时没有 `model` 项。处理方式是在写入**之前**订阅 `#configUpdates`；如果返回结果里确实缺少 `model` 项，就等待**同一 Session** 发来的匹配 `config_option_update`。等待与 RPC 共用同一个超时。以下情况都不能作为确认：来自其他 Session 的通知、值不匹配的通知、写入之前的通知。这里不会重试写入，也不会用默认 Model 代替。测试见 `test/acp-effort.test.ts`。
- Fork、回滚和恢复之后，原生子 Session 会把配置重置为默认值。`open()` 在 `loadSession` 后会依次重写 `model`、`autopilot`，最后写 `effortLevel`。effort 写入前先检查当前 Model 是否提供该选项：没有任何 effort 选项时返回 `unsupported`，有选项但不含请求值时返回 `invalidRequest`。Model 为 `auto` 时不恢复 effort。
- `KiroSession` 用 `#configBusy` 保证同一时间只进行一项配置写入。Model 和 Thinking 允许在回合进行中切换（`kiro-adapter.test.ts` 用例 “selects during a Turn”），Permission Mode 在回合进行中返回 `sessionBusy`；尽管能力表声明了 `permissionModeScope: "live"`，这条限制仍然生效。

## 模型目录与 effort（`src/models.ts`）

- Model 目录完全来自原生数据，`KIRO_DEFAULT_MODELS` 为空，Adapter 不内置任何 Model。`inspect()` 的取数优先级：
  1. 如果 initialize 中 `agentCapabilities._meta.kiro.extensionMethods` 包含 `_kiro/config/template`，先 `authenticate`，再轮询该模板，直到拿到非空目录或超时。认证会触发异步刷新目录，模板里保留了每个 Model 的 effort 元数据。
  2. 否则调用 `kiro-cli chat --list-models --format json`，结果交给 `parseKiroCliModels` 解析。
- 每个 Model 支持的 effort 范围：`auto` 恒为空；当前 Model 以 `effortLevel` configOption 为准；其他 Model 读取 `_meta.kiro.effortLevels`，`hasEffort === false` 时为空。
- Inspection 按 cwd 缓存，下次刷新时间取 24h 和下一个 UTC 月初中较早的那个。缓存过期后先返回旧值，再在后台刷新。`notInstalled` 和 `authenticationRequired` 会清掉缓存（`KiroAdapter#refreshInspection`）。
- 启动参数禁止带 `--model` 或 `--trust-all-tools`，`test/command.test.ts` 有对应断言。

## 权限模式（`src/permission-modes.ts`）

- Host 侧只有 `autopilot`（默认）和 `supervised` 两种，分别映射到原生 configOption `autopilot` 的 `"on"` 和 `"off"`。`encodeKiroPermissionMode` 同时接受 `session.json` 中的布尔值 `false`。
- `open({ executionPolicy: "unattended-full-access" })` 直接返回 `unsupported`，不会借 autopilot 冒充无人值守的完全访问。

## 交互：审批与 Question

- ACP 的 `requestPermission` 分两种投影：
  - `_meta.kiro.kind === "analyze-requirements"`：由 `projectKiroRequirementQuestion` 投影为单选 Question。选项必须全部是 `allow_once`，且 ID 不能重复，否则抛错。
  - 其他情况：由 `projectKiroPermission` 投影为审批。`turn_approval` 会在描述里列出本回合改动的文件。consent 生成 “this session”（`allowForSession`）和 “save for workspace”（`allowAlways`）两类动作，后者要求 `workspaceRoot` 存在。只有简单命令才提供命令前缀选项，`sudo`、`doas`、`env` 除外。真正的策略解析和执行仍由 Kiro 负责。
- 客户端扩展方法只实现了 `_kiro/userInput`（`projectKiroUserInput`），其他方法一律抛出 `Unsupported Kiro client extension method`。没有活动 Prompt 时，审批返回 `cancelled`，userInput 返回 `dismissed`。
- 并发交互：每个请求生成独立的 `HostInteractionId`，记入 `#pendingInteractions`，回答可以乱序到达。无效回答、重复回答、类型不匹配的回答都会返回 `invalidRequest`，对应的交互保持挂起。回合结束、取消、fault、close 时，`#cancelInteractions` 会在 `turn.completed` **之前**逐个 resolve 挂起的交互，并发出 `interaction.closed(reason: "cancelled")`。
- `#cancelTurn` 先通知原生 `cancel`；如果回合仍然活跃，再清理交互，因为原生取消通知可能先把 Prompt 结束掉。

## 命令：静态 vs 实时

- `src/commands.ts#KIRO_COMMANDS` 是静态 Harness 命令，每个都映射到原生请求，不经过 Prompt：
  - `kiro.compact` → `_kiro/session/compact`，发出 `contextCompaction` Item
  - `kiro.context` → `_kiro/session/context {subcommand:"show"}`
  - `kiro.usage` → `_kiro/account/getUsage`
  - `kiro.plan`、`kiro.spec`、`kiro.vibe` → `session/set_mode`
  - 查询结果由 `formatKiroCommandResult` 渲染成表格。渲染前按 token、password、secret、Bearer 等规则脱敏，JSON 截断到 64KB。
- `src/kiro-slash-commands.ts` 负责实时命令：解析 ACP `available_commands_update`，其中 `_meta.kiro.type === "skill"` 的条目投影为 skill，其余投影为 command。命令 ID 前缀为 `kiro.slash.`。执行时由 `liveHarnessCommandPrompt` 转成以 `/name` 开头的 Prompt 文本，走普通回合流程。
- `available_commands_update` 属于命令目录状态，不属于回合内容，也不进入 replay（`#handleUpdate` 提前 return）。
- 回合中的原生 `session_info_update` 如果带 `_meta.kiro.kind === "summarization_completed"`，也会投影为 `contextCompaction` Item（`KiroSession#runTurn`）。
