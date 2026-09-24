# CodeBuddy：ACP 传输、配置与 Session

## 进程与传输（`acp-client.ts`）

- 每个可写 Session 独占一个 `codebuddy --acp` 子进程；inspect 另起一个带 `--no-session-persistence` 的一次性进程，只读 `configOptions`，不发 Prompt（`codebuddy-adapter.ts` 的 `#inspect`）。inspect 结果按 cwd 缓存到 `refresh: true` 为止，失败结果也会缓存。
- `initialize` 要求 `protocolVersion === 1` 且 `agentCapabilities.loadSession`，否则返回 `unsupported`。客户端能力声明 `_meta: { "codebuddy.ai": { question: true } }`。
- 所有请求都经 `#request`：先检查 `#failure` / `#exitFailure` / `#closing`，再与 `#failed` Promise 竞速，带 label 时用 `bounded()` 超时（默认 15s，open 20s）。新增 ACP 调用要走这个入口，不要直接调 `#connection`。
- 进程 `exit` 后不立即 fault，而是等 250ms 把已写入管道的更新排空（`#exitDrainTimer`），因为后代进程可能一直占着管道不产生 EOF。
- 关闭顺序：`stdin.end()` → 等 1s → 若父进程已退出，只销毁管道，**不要**对可能被复用的 PID 发信号 → 否则 Windows `taskkill /T /F`，POSIX `process.kill(-pid, "SIGKILL")`（子进程以 `detached` 建进程组）。`derivation.ts` 的 `copyCodeBuddySession` 用同样的规则。

## 原生扩展（只在本包出现）

| 方法 | 用途 | 位置 |
|---|---|---|
| `_codebuddy.ai/question`（服务端 → 客户端 extMethod） | 旧版问题回调 | `acp-client.ts` |
| `_codebuddy.ai/resolveInterruption` | 回答 `AskUserQuestion`；要求响应 `resolved === true` | `answer()` |
| `_codebuddy.ai/session/rollback`（`reason: "resend_edit"`, `files: false`） | 回退到指定消息，不回退文件 | `rollback()` |
| `_meta["codebuddy.ai/outcome"]` | Turn 结果；`PARTIAL_SUCCESS` 仍算成功（错误留在各 Item 上） | `session.ts` 的 `#run` |
| `_meta["codebuddy.ai/sessionReset"]` / `newSessionId` | 原生 `/fork` 报告的新 Session ID | `derivation.ts` |

`AskUserQuestion` 以 ACP permission 请求的形式到达（`_meta["codebuddy.ai/toolName"]`）。回答时先调 `resolveInterruption`，再把挂起的 ACP permission 以 `cancelled` 结束（`interactions.ts` 注释：原生扩展已经结算了该 Tool）。

## 配置（`configuration.ts`）

- 目录完全来自 ACP `configOptions` 的 `model` / `mode` / `thought_level` 三项，不硬编码 Model 或权限模式列表。
- Model Ref 为 `cb.` + base64url(原生 ID)；`nativeModel()` 解码后会重新编码比对，不是规范形式就报 `invalidRequest`。WorkBuddy 的 `product-models.ts` 也用 `modelRef`，改编码会影响两个包。
- 每次设置都要用 `confirmedConfiguration` 读回 `currentValue`，不一致就报 `protocolError`。
- `bypassPermissions` 与 `fullAccess` 标为 `dangerous`。无人值守创建（`executionPolicy === "unattended-full-access"`）必须设 `fullAccess`，因为 `bypassPermissions` 仍保留原生 HIGH/CRITICAL 检查（`session.ts` 的 `initialize` 注释）；传入其他权限模式时 `open` 直接返回 `invalidRequest`。
- `allowUnlistedModelSelection`：当前 Model 不在 option rows 里时，默认报 `protocolError`；只有设置了该字段的 Profile（WorkBuddy Windows）会把它补进目录。

## Session（`session.ts`）

- **连接代次**：`#createClient` 每次递增 `#generation`，回调里先比对代次。取消恢复、故障后旧进程的晚到更新不会污染新 Turn。
- **取消后重建进程**：原生 CLI 在取消后可能残留取消状态。`#resumeAfterCancel` 关闭旧进程，用新进程 `session/load` 同一 Session，再按顺序重新应用 Model → Thinking → Permission，之后才结束 Host Turn。恢复失败就让 Session fault，不要返回“看似可用”的连接。
- **打开时补回滚**：`#openClient` 在每次新进程 load 后检查历史末尾是否仍是 `resend-fork-notice`；若是，就重新调用 rollback 并确认 `actualForkPointId`。初次 resume 和取消恢复共用这条路径。原因见 [history-and-derivation.md](history-and-derivation.md)。
- **Turn 结算**：Prompt 返回后重新读快照，普通 Prompt 必须恰好新增 1 个 Native Turn；`response.userMessageId` 与历史里的 Turn key 必须一致。本地命令可以不产生 Turn，这时不伪造 `nativeTurnRef`。
- 回放期间（`#replaying`）的 permission / question 一律 `cancelled`，更新一律丢弃。
- `usage_update` 提供上下文窗口占用；累计用量来自历史（`historyUsage`，每个模型请求计一次），CodeBuddy credits 按 credits 报告，不换算美元。

## 命令目录（`slash-commands.ts`）

- Adapter 级静态目录 `CODEBUDDY_COMMAND_CATALOG` 只含已验证的 `/compact` 与 `/cost`，供 Desktop 在未打开 Session 时显示；执行时仍要求该命令出现在 Session 的实时 `available_commands_update` 中。
- `excluded` 集合里的命令会切换 Session、脱离当前 Thread 或依赖原生 UI（`fork`、`clear`、`resume`、`rewind`、`login` 等），永远不暴露。新增排除项写进这个集合并附理由。
- `nativeCommandsEnabled(profile)`：CodeBuddy 默认开启；设置了 `staticCommandCatalog` 的 Profile 只用静态目录，忽略实时更新（`session.ts` 注释：WorkBuddy 故意只暴露审核过的静态目录）。
- `/compact` 成功必须以历史中新持久化的 `isCompacted` 摘要为证据；缺少持久化结果时报 `protocolError`。

## 错误映射（`common.ts` 的 `nativeError`）

`CodeBuddyError` 自带 `code`；其余按原生信息推断：JSON-RPC `-32000` 或 “authentication required / not logged in” → `authenticationRequired`，`ENOENT` → `notInstalled`，“session … not found” → `sessionNotFound`，其余 → `nativeFailure`。消息统一加 `${profile.displayName}: ` 前缀，并先经 `sanitizeDiagnosticTail`。只有 `sessionBusy` / `unavailable` 可重试。

## 子 Agent 与委派

- 原生 Agent 子任务通过 `_meta["codebuddy.ai/parentToolCallId"]` 识别，只观察已登记的调用，以 750ms 间隔读取 `<sessionId>/subagents/*.jsonl`（`subagents.ts`、`subagent-history.ts`）。子 Thread 内容只能来自原生文件，不维护影子 Transcript。读失败或看到 assistant 消息都不代表子任务完成。
- 跨 Harness 委派：四个环境变量 `CODEXHOST_CLI_PATH` / `CODEXHOST_RUNTIME_ENDPOINT` / `CODEXHOST_RUNTIME_TOKEN` / `CODEXHOST_THREAD_ID` 齐全且非 ephemeral 时，才追加 `--append-system-prompt CODEBUDDY_DELEGATION_INSTRUCTIONS`（`command.ts`）。提示词里只写变量名，令牌只留在子进程环境中。
- macOS 受管远程 Host（`context.managedRemoteHost`）改用 `BrokeredHarnessAdapter`，并设置 `liveCommandCatalog: true`（`plugin.ts`）。
