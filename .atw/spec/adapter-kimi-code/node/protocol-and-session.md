# ACP 传输与会话

## 分层

| 层 | 文件 / 符号 | 职责 |
|---|---|---|
| Transport | `src/acp-transport.ts` `KimiAcpTransport` | 启动 `kimi acp` 进程，完成 ACP 握手，处理 `session/new\|load\|fork`、`set_config_option`、`prompt`、`cancel` 和 `session/close`，并把 `session/update` 投影成 `KimiTransportEvent` |
| Adapter | `src/kimi-adapter.ts` `KimiAdapter` | `inspect`（可执行文件、`config.toml`、认证），`open` 的 create/resume/fork/rollbackLastTurn 编排，每次 open 新建一个 transport |
| Session | `src/kimi-session.ts` `KimiSession` | 回合驱动、Item 流、交互桥接、配置命令、usage、命令日志、transport fault 收尾 |
| 纯函数 | `models.ts`、`projection.ts`、`slash-commands.ts` | ModelRef 编解码、configOptions 解析、审批和 Elicitation 投影、工具名规范化、命令目录与输出格式化 |

Adapter 与 Session 之间通过 `KimiAcpTransportLike` 接口（`kimi-adapter.ts`）解耦。测试用 `KimiAdapterDependencies.createTransport / resolveExecutable / rollbackNativeSession` 注入替身，新增依赖也沿用这种注入方式。

## 传输（`KimiAcpTransport`）

- 启动：`kimiInvocation` → `commandInvocation(command, ["acp"])`，`spawn` 时使用 `stdio: pipe` 和 `windowsHide`，**不设置 `detached`**。初始化固定使用 `protocolVersion: 1`，并声明 `clientCapabilities.elicitation.form`。响应版本不是 1 时抛 `protocolError`。
- 同一个实例只能启动一次，`#ensureInitialized` 遇到已有 child 会抛 "cannot be started twice"。Adapter 每次 `inspect` 或 `open` 都新建 transport。
- 超时：`withTimeout` 超时后抛 `KimiRequestTimeoutError`（kind 为 `unavailable`）。默认 `commandTimeoutMs = 30_000`，`inspect` 使用 15 秒。`prompt` **不设超时**，回合结束以原生 `PromptResponse` 为准。
- 关闭：先以不超过 2 秒的超时发送 `session/close`，然后执行 `stdin.end()`。进程在 `min(2500, closeTimeoutMs)` 后仍未退出就发 `SIGTERM`，等待 `closeTimeoutMs` 后再发 `SIGKILL`。这里只结束直接子进程；Grok 和 Kiro 会向整个进程组发信号，Kimi 不会。
- 错误：统一使用 `KimiTransportError(kind, message, { diagnostic })`，kind 取值见 `KimiTransportFaultKind`。stderr 经 `sanitizeDiagnosticTail` 累积到 `#stderrTail`。非主动关闭时，进程 `exit` 或 `error` 通过 `onFault` 交给 `KimiSession.handleTransportFault`。
- 事件路由（`#handleSessionUpdate`）：
  - 文本、thought、工具、`usage_update` 只发给当前 `ActivePromptHandler`，没有活动回合时直接丢弃。
  - `config_option_update`、`current_mode_update`、`available_commands_update` 走 `SessionEventHandler`。handler 尚未注册时先暂存到 `#pendingSessionEvents`，注册后回放。
- 没有活动回合时收到 `requestPermission`，回复 `cancelled`；收到 Elicitation，回复 `cancel`。`extMethod` 同时兼容 `elicitation/create` 和 `session/request_permission` 这两种扩展方法名。
- 已知残留：`#pendingConfigUpdates` 只在读取处出现，没有任何地方注册监听，是空转代码。需要"等待 config 通知确认"时，参考 `kiro-cli/README.md` 的做法重新设计，不要以为这里已经实现。

## 配置：Model / Thinking / Permission Mode（`models.ts`）

- ModelRef：`kimi.` 前缀加 base64url 编码的原生 alias（`encodeKimiModelRef` / `decodeKimiModelRefId`），可以承载含 `/` 等字符的 alias。
- 启动检查的模型目录来自 `config.toml`（`parseKimiConfigToml` → `buildModelCatalogFromConfig`），只含 Model，`thinkingOptions: []`。`buildModelCatalogFromAcp` 目前只在测试中使用，生产路径没有调用。
- 会话内的 Thinking 列表来自 ACP `configOptions` 中 `id === "thinking"` 的项（`readKimiThinkingOptions`，支持分组选项）。列表写入 `state.availableThinkingOptions`，每个会话单独保存。
- 写入流程（`applyRequestedConfig`、`#handleModelSelect`、`#handleThinkingSelect`、`#handlePermissionModeSelect`）：调用 `setConfigOption(id, value)`，用返回的完整 `configOptions` 调用 `#applyConfigOptions` 整体替换状态，再比对 effective 值。不一致时返回错误；create/resume 阶段则让 open 失败。
- Thinking 值不在当前列表时抛 `KimiThinkingSelectionError`，映射为 `invalidRequest`（测试："rejects a stale Thinking selection using the newly selected Model's options"）。
- `#applyConfigOptions` 会先删除 `effectiveModel`、`effectiveThinkingOptionId`、`effectivePermissionModeId`，再按响应重新填写。响应里缺少的设置因此会被清除（测试："clears effective settings absent from the full config response"）。
- Permission Mode：`KIMI_MODES = default | plan | auto | yolo`，其中 `yolo` 标记为 `dangerous`，通过 ACP 的 `mode` config 写入。`current_mode_update` 通知也会更新状态。
- 上下文窗口：`resolveKimiContextWindow` 读取 `config.toml` 中的 `max_context_size`，缺省为 200_000。

## 回合（`#runTurnBody`）

1. 发起 prompt 前，先读取原生 turn 键集合（`previousNativeTurnKeys`）。
2. 流式处理事件：thought 生成 reasoning Item；文本生成 agentMessage，工具调用之前的文本记为 commentary，工具调用之后的结尾文本记为 `final_answer`；工具调用由 `KimiToolCallAccumulator` 累积，再用 `createHostItemFromToolState` 生成 Item。prompt 被拒绝时，所有已开始的工具都以 failed 结束（测试："settles every started tool before a rejected prompt completes"）。
3. 回合结束后调用 `#waitForNativeTurn`：在 `nativeTurnFlushTimeoutMs`（默认 6 秒）内轮询 `wire.jsonl`，查找新增且输入文本相同的 turn。出现多个匹配时返回错误；找不到匹配时，回合以 `protocolError` 失败（测试："does not report success without a durable Native Turn identity"）。
4. 文件变更 Item 不来自 ACP 流，而是从关联到的 Native Turn 历史中补发 `fileChange`。
5. usage 优先取 `PromptResponse.usage`（`parseKimiUsage`），然后用 `#refreshUsage` 从 wire 日志汇总，并发出 `session.usage.changed`。
6. 取消：`#handleTurnCancel` 只发送 ACP `cancel`，然后等待原生 prompt 返回终态，不使用本地计时器（测试 `acp-lifecycle.test.ts`："waits for the native prompt terminal response instead of a 500ms cancellation timer"）。

Transport fault 的顺序（`handleTransportFault` → `#finishTransportFault`）：关闭交互，关闭 transport，等待当前回合结束，然后发出 `session.faulted` 并结束输出流。先完成回合、再发布 fault 的顺序不能颠倒（测试："finishes the turn before publishing a transport fault and ends the output stream"）。

## 交互（`projection.ts`）

- 审批：原生 `allow_always` 映射为 `allowForSession`（原生语义就是会话级），`reject_*` 映射为 `deny`。`optionIdByActionId` 保存在交互的 `metadata` 中，回复时还原成原生 `optionId`。
- 提问：ACP Elicitation（form）投影为 `HostQuestionInteraction`，回复由 `formatElicitationResponse` 按 schema 属性类型组装。
- 回合结束、取消、close 和 fault 时，`#closeActiveInteractions` 会给所有挂起的交互回复 cancelled/cancel，并发出 `interaction.closed`。

## Slash commands（`slash-commands.ts`）

- 命令目录以原生 `available_commands_update` 为准（`buildKimiCommandCatalog`），在 `KIMI_DEFAULT_COMMANDS`（compact/status/usage/mcp/tasks/help）的基础上动态替换。目录通过 `onCommandsUpdate` 回写到 `KimiAdapter.commandCatalog`，`adapter.close()` 时重置为默认目录。
- 执行：不在当前目录中的命令返回 `invalidRequest`（测试："does not accept commands missing from the native catalog"）。命令以 `/name args` 文本 prompt 的形式发送。输出经 `formatKimiCommandOutput` 去掉 ANSI 并整理成 Markdown，这部分按 `/help`、`/status`、`/usage` 等原生文本格式逐个匹配。原生输出格式变化时，要同时更新这些正则和 `test/slash-commands.test.ts`。
- 命令回合不进入 `wire.jsonl`，因此单独写入命令日志，见 [history-and-rollback.md](history-and-rollback.md)。

## 验证

```bash
npx vitest run --config tests/vitest.config.js packages/adapters/kimi-code/test/kimi-session.test.ts packages/adapters/kimi-code/test/acp-lifecycle.test.ts packages/adapters/kimi-code/test/acp-transport.test.ts packages/adapters/kimi-code/test/models-and-config.test.ts packages/adapters/kimi-code/test/slash-commands.test.ts
```
