# Turn 生命周期、投影、权限与提问

## 进程模型

- 一个 Turn 对应一个 `agy` 子进程，没有常驻连接。参数在 `AntigravitySession.execute` 中组装：
  ```ts
  ["--input-format","stream-json","--output-format","stream-json","--print-timeout", printTimeout]
  // 已有 nativeRef 时在最前面加 --conversation <id>，之后依次追加：
  ...antigravityModelArguments(model, thinking), "--dangerously-skip-permissions",
  "--add-dir", cwd, "--add-dir", questions.directory, "--log-file", logPath
  ```
- `--print-timeout` 默认值是 `"30m"`（`DEFAULT_PRINT_TIMEOUT`）。`logPath` 是 `os.tmpdir()` 下每个 Turn 各自的日志文件，进程 `close` 时删除。
- 启动通过 `commandInvocation(executable, args, env)`（来自 harness-discovery），并设置 `windowsVerbatimArguments`。子进程 cwd 必须是 Thread 的 cwd，测试 `passes --add-dir <cwd> and strictly binds child process cwd to thread project directory` 覆盖了这一点。
- 取消（`#cancel`）的顺序：标记 `cancellationRequested`，调用 `questions.stop()`，调用 `subagents.cancel()`，最后 `active.process.kill()`。这里没有进程组 kill，与 grok / kiro-cli 的 `signalProcessTree` 不同。
- 收尾（`#completeTurn`）会把清理串到 `#questionCleanup` 链上：失败或取消时先 cancel 子代理，再等 `subagents.settled`，然后 `stdin.end()`；2 秒后仍未退出就 `kill()`；最后 `questions.dispose()`。`close()` 会 await 这条链，并 `history.flush()`。
- `isActive` 包含三种情况：有活动 Turn、提问桥正在准备、有仍在运行的子代理观察器。父 Turn 结束但子代理仍在运行时，新输入会返回 `sessionBusy`。这是设计如此（见 `antigravity-subagents.md` 的 Boundaries 一节）。

## stream-json 事件

`stream-events.ts#parseAntigravityStreamLine` 只做字段存在性检查后直接断言类型（没有使用 zod）。不认识的行返回 `null`，调用方把非空的未知行追加到 `stderr` 尾部（最多保留 8000 字符），用于诊断。

| 事件 | 处理（`#handleEvent`） |
|---|---|
| `init` | 记录 `init.permission_mode`。如果已有 nativeRef 但 `conversation_id` 不一致，Turn 以 `sessionNotFound` 失败，并 kill 进程。否则绑定 nativeRef，并调用 `history.bindNativeSession` |
| `step_update` | 丢弃 `conversation_id` 与当前会话不一致的事件（子代理的步骤不走这里），再交给 `#handleStep`，并发布 usage |
| `result` | `#handleResult`：等待上下文用量和子代理刷新，然后按 `status`（`"SUCCESS"`）结束 Turn |
| `command_result` | 只出现在单独的 `--print=/<cmd>` 调用中（`quota.ts`），Turn 流里会被忽略 |

`#handleStep` 的要点：

- `agent_response`：`text_delta` 是增量，`text`、`content`、`message` 可能是累计快照。`#appendOrSyncAgentText` 负责去重，测试见 `correctly handles cumulative text snapshots without duplicating text`。
- `subagent`：交给 `AntigravitySubagents.handle`。无法识别时降级为普通 tool 步骤。
- `tool`：开始时会带工具名和参数，结束时只带变化的字段，因此未能创建 Item 的步骤要先存进 `pendingSteps`，之后用 `mergePendingStep` 合并。
- 原生 `ask_question` 在 stream 中表现为 `agent_response` 或 `unknown`，**不会**以 `tool` 步骤出现（postmortem 第 3.2 节）。提问只能走 Hook 桥，不要试图从 stdout 识别。

## 工具与文件变更投影

- `tool-projection.ts#compactToolName` 会去掉命名空间前缀（`default_api:`、`functions.`）、转小写并去掉 `_-`，再与 `COMPACT_WRITE_TOOLS`、`COMPACT_REPLACE_TOOLS`、`COMPACT_COMMAND_TOOLS` 匹配。参数支持多种大小写和 `input`、`arguments`、`params`、`parameters` 嵌套，见 `adversarial-stress.test.ts` 第 5、8 组。
- stream 里的写文件步骤只带 `TargetFile`，不带内容（`code-action-diff.ts` 文件头注释）。直接合成 patch 会得到一张空的 `+N -0` 卡片。真实 diff 通过 Language Server 的 `GetCascadeTrajectorySteps` 读取 `CORTEX_STEP_TYPE_CODE_ACTION`，由 `#claimFileChange` 按 `codeActionCursor` 顺序认领，避免同一文件的多次编辑被映射到同一个 action。
- patch 无法解析时，步骤在终态前不出卡片。进入终态后降级为 Tool Execution。Turn 中断时，`pendingSteps` 会作为 Tool Execution 补发，不会被静默丢弃（`#completeTurn` 中的注释）。
- 路径比较要兼容 Windows 大小写和 `file://` 与平台分隔符的差异（`sameFile`）。`displayPath` 会拒绝包含 `\0` 或换行的路径。

## Usage 与上下文窗口

- Token 用量来自 `step_update.usage` 和 `result.usage`（`hostUsage`）。上下文占用来自 Language Server 的 `GetCascadeTrajectoryGeneratorMetadata`（`parseAntigravityContextUsage`），轮询最多 8 秒。
- `resolveAntigravityContextWindow` 按 Model 家族决定窗口大小：`claude*` 为 200k，`gemini*` 或未知时为 1M。有专门测试覆盖同一会话内切换 Model。

## Model 与 Thinking

- `agy models` 列出的 ID 自带 effort 后缀（`gemini-3.1-pro-low`）。`parseAntigravityModels` 按 base ID 分组，把后缀转换成每个 Model 各自的 `supportedThinkingOptionIds`。
- `antigravityModelArguments` 生成 `--model <base> --effort <x>`。如果旧 Thread 的 Model ID 仍带后缀，就不加 `--effort`，因为 CLI 会拒绝二者同时出现（文件头注释列出了 CLI 的实际报错）。
- 选择新的 Model 时，如果它不接受原来的 effort，就清空该 effort（`#selectModel`）。`open` 和 `#selectThinking` 遇到不被接受的 effort 时返回 `invalidRequest`，不等到第一个 Turn 才由 CLI 报错。

## 权限：只有 Skip permissions

- `permission-modes.ts` 的目录里只有 `dangerously-skip-permissions`（`dangerous: true`，也是默认值）。每个 Turn 都会传 `--dangerously-skip-permissions`。
- 原因是 headless 模式无法回传交互式审批：需要审批的操作会被 soft-deny，并被报告为一个空的成功 Turn。旧的 Configured permissions 和 Desktop approvals 已经移除（`antigravity-tool-approval.md`）。
- `decodeAntigravityPermissionModeId` 对旧的模式 ID 直接抛错，由调用方转成 `invalidRequest`，**不静默转换为 skip**。
- 原生拒绝仍然会出现：`isAntigravityPermissionDenial` 识别工具错误文本。如果 Turn 以 `SUCCESS` 结束，但没有 agentMessage 且有拒绝记录，就改为以 `permissionDeniedTurnError`（`nativeFailure`，并对 diagnostic 脱敏）失败，不伪装成成功。
- 不要为普通工具加 Hook 拦截来模拟审批。PreToolUse 在工具执行前触发，并不是原生的审批请求/应答通道（capability-boundaries）。

## 提问桥（ask_question）

- 每个 Turn 用 `AntigravityQuestionBridge.create` 建一个桥：HTTP 服务只监听 `127.0.0.1`，端口随机，鉴权使用随机 32 字节 token 和 `timingSafeEqual`。桥在临时目录写入 `question-hook.cjs` 和 `.agents/hooks.json`，matcher 为 `^ask_question$`，再通过 `--add-dir` 交给 agy，不修改项目或全局的 hooks.json。
- `question-hook-client.ts` 是嵌入在 `String.raw` 里的 CJS 源码，这样单文件发布 Bundle 不需要额外资源。修改它等于修改运行时脚本，必须跑 `question-bridge.test.ts`，该测试会通过真实 shell 执行生成的命令。
- 答案通过 `{"decision":"deny","reason":...}` 回传给模型：用 deny 阻止原生的自动跳过，把答案放进 reason。**不要改用 `userMessage` 注入**，它会新增 `SYSTEM_SDK` 用户输入并改变 Turn 边界（postmortem 8.1 节）。
- 限制：请求体最大 128 KiB，默认 10 分钟超时，同一时间只允许一个待答问题，重复的 `conversationId:stepIdx` 会被拒绝，每个桥最多 128 个问题。多选会被明确拒绝，因为 Desktop 投影没有多选字段。过期、断连或 Turn 结束时，一律返回“未收到回答”的 reason，不伪造用户选择。
- Windows 坑：agy 的 Go exec 会转义双引号，导致 `cmd.exe` 把引号当作路径字符。因此 Hook 命令改用 `%CODEXHOST_AGY_QUESTION_NODE% %CODEXHOST_AGY_QUESTION_CLIENT%` 这种环境变量展开的写法（postmortem 8.3 节，测试 `executes the native shell command when the Hook path contains spaces`）。
- 桥接产生的 Item 名为 `codexhost.ask_question`，与原生工具结果区分开。原生侧仍会记录一个被阻止的错误步骤，不要改写这个事实。
- postmortem 第 1–7 节是历史结论，其中“`interaction.respond` 返回 unsupported”、“提示词禁止调用 ask_question”都已失效。现行代码中，`interaction.respond` 路由到 `active.questions.respond`，`ANTIGRAVITY_WORKSPACE_FILE_INSTRUCTION` 要求模型通过 Hook 提问。
