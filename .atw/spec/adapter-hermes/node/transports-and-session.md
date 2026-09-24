# Hermes 传输、路由与会话

## 路由（`HermesAdapter.open` / `inspect`）

| 输入 | 路径 |
|---|---|
| create，且 `#gatewayPython()` 找到可用 gateway | gateway（`#openGateway` → `openGatewaySession`） |
| create，找不到可用 gateway | ACP |
| resume/fork/rollback 的 Ref，`locator.transport === "gateway"` | gateway；gateway 不可用时返回 `unavailable`，不回退 |
| resume 的 Ref 没有 gateway locator（旧 ACP 会话、会话导入的结果） | ACP，永远不升级到 gateway |
| fork/rollback 的 Ref 没有 gateway locator | ACP 返回 `unsupported`（“Hermes does not support fork”） |

- gateway 探测（`HermesGatewayTransport.probe`）：按 `CODEXHOST_HERMES_GATEWAY_PYTHON`、从 hermes shim 中解析出的 venv python（`venvPythonFromShim`）、`inventoryPythonCandidates()` 的顺序逐个尝试，能真正 `start()` 成功的第一个胜出。探测结果按 cwd/环境缓存在 `#gatewayProbes` 中，`inspect({ refresh: true })` 会清空缓存。
- 会话导入走 ACP `session/list`（`hermes-import.ts`），得到的 Ref **没有 locator**，所以导入的会话一律按 ACP 打开。

## gateway 传输（`gateway-transport.ts`）

- 启动命令：`<python> -I -u -c "<委派 bootstrap>import runpy; runpy.run_module('tui_gateway.entry', ...)"`。`-I` 隔离工作区里的同名模块；环境变量固定加 `HERMES_TUI_TOOL_PROGRESS=all` 以启用工具生命周期事件，不修改用户配置。
- 握手：`gateway.capabilities` 的 `per_session_exclusive_submit` 必须为 `true`，否则视为不可用（ACP 在这里作为后备）。
- 帧：JSON-RPC 2.0，每行一帧。`method: "event"` 是通知；带 `id` 和 `method` 的是 gateway 向 Host 发出的请求，只接受当前 Session 的 `clarify` 和 `approval`，其余一律回复 `-32601`。
- 一个 gateway 进程只服务一个公开 Session（`openGatewaySession` 的注释）。`request()` 超时会让整个 transport fault 并关闭。关闭流程：stdin.end → 2 s → SIGTERM 进程组 → 2 s → SIGKILL；Windows 用 `taskkill /t /f`。关闭后删除委派 Skill 的临时目录。
- runtime ID 与持久化 ID 不同：`session.create/resume` 返回 `session_id`（runtime），Host 保存的是持久化根 ID（`stored_session_id`）。打开时通过 `history.resolvePhysicalSessionId()` 核对二者；压缩生成 continuation 后，仍由 Hermes 官方 lineage 解析回同一个根。
- cwd：用 realpath 比较 Ref locator 里的 `cwd`、请求的 cwd、原生 `info.cwd`，不一致就返回 `unsupported`（`forkAcrossCwd: false`）。

## ACP 传输（`acp-transport.ts`）

- `hermes acp` 由 `commandInvocation()` 启动，使用 `@agentclientprotocol/sdk` 的 `ClientSideConnection`。`session/load` 会先回放对话再响应（`HermesOpenResult.replay`），`hermes-session.ts` 的 `historyTurnsFromReplay()` 用回放内容重建历史 Turn。
- `inspect()` 会保留一个热进程（`#keepWarmTransport`），供随后同一 cwd/环境的 `open()` 复用，避免再次冷启动 Python。
- ACP 能力：`fork`/`rollbackLastTurn` 为 `false`，`selectThinkingOption: false`；权限目录是 `default`/`accept_edits`/`dont_ask`（`hermes-models.ts`）。命令只暴露 `available_commands_update` 实际公布的那一组。

## 共用 Session 外观

`HermesSession`（`hermes-session.ts`）同时服务两条传输，差异通过 `HermesSessionTransport` 接口隔离。`HermesGatewaySessionTransport` 把 gateway 事件**转换成 ACP 形状**的 `HermesTransportEvent`/`ToolCallContent`，所以 `hermes-session.ts` 里出现 ACP 类型并不代表只有 ACP 在用。能力差异由构造参数决定：`supportsDerivation`（只有 gateway 为 true）决定 fork/rollback，`transport.setThinking` 是否存在决定 Thinking。

## Model、Thinking、Permission（gateway）

- Model：`resolveGatewayModel()` 选定后调用 `config.set { key: "model", scope: "session" }`。`confirm_required` 时直接报错，不替用户确认；设置后再对照 `info.model/provider` 核实。模型目录来自 `hermes-inventory.ts` 用 Python 一次性探测得到的原生 inventory，并发读取会合并成一次，超时 20 s。超时时如果已有上一次成功读取的目录，就沿用它；其他错误照常上报。
- Thinking：固定为 `none/minimal/low/medium/high/xhigh/max/ultra`（对应原生 `parse_reasoning_effort`），`config.set` 后再用 `config.get` 回读，两次都一致才算成功。
- Permission：gateway 只有 `default`（关闭会话 YOLO，遵循全局审批策略）和 `dont_ask`（会话 YOLO）。回读发现 `info.yolo` 与请求不符时报错，并提示检查全局 approvals 策略，不能把“关闭会话开关”误报成“已恢复审批”。确认后的模式写入 Native Ref 的 `locator.permissionModeId`，resume 时恢复；Fork 继承源 Session 的有效模式。`unattended-full-access` 要求使用 `dont_ask`。

## 交互、命令、压缩、Diff

- `clarify` 映射为 Host Question（单题或 `questions[]` 批量；支持文本、单选、多选）。多选答案用 JSON 数组编码回传，避免选项中的逗号被拆开。取消时回复 `{}`；请求被原生取消、超时（映射为 expired）或关闭后，不再回复迟到的答案。
- 审批保留原生的 `once`/`session`/`always`/`deny`，分别映射为单次、会话、永久、拒绝。
- 命令：gateway 固定为 `/help /tools /context /version`（走 `slash.exec`）和 `/compress [focus]`（走 `session.compress`），不进入对话记录，也不生成虚构的 NativeTurnRef。`/reset`、原地 undo/rewind、queue/steer 都不暴露。
- 压缩：`compressed` 且不是 noop 才算成功；pending 时关闭 Session，避免原生任务与下一轮重叠；`aborted` 使 Item 和 Turn 都失败。ACP 路径的判定由 `hermes-compaction.ts` 根据原生结果文本完成。
- Edit Diff：两条路径都只在工具**完成**后投影 `fileChange`，统一标记 `diffScope: "fragment"`、`kind: "update"`；每个工具最多 32 个片段、1 MiB（`hermes-file-changes.ts`）。gateway 的 `inline_diff` 带 ANSI 转义且可能被截断，`gatewayDiff()` 按明确的 hunk 状态解析，正文里的 `---`/`+++` 不会被当成文件名。

## 跨 Harness 委派（`gateway-delegation.ts`）

只有当 `CODEXHOST_CLI_PATH`、`CODEXHOST_RUNTIME_ENDPOINT`、`CODEXHOST_RUNTIME_TOKEN`、`CODEXHOST_THREAD_ID` 四个变量都存在时，才会在 OS 临时目录写一个私有的 `SKILL.md`（`0o600`），并通过 bootstrap 代码调用 `PluginContext.register_skill` 在**当前 gateway 进程内**注册 `codexhost-runtime:delegation`，同时追加到 `HERMES_TUI_SKILLS`。Skill 内容不包含变量值。inspection、gateway probe、history reader 都不注册它。旧 ACP 会话没有这项自动发现。
