# Qoder：SDK 会话、历史与配置

> 通用约定见 `.atw/spec/adapters/node/index.md`。

## inspect（`qoder-adapter.ts`）

- 先 `resolveExecutable`；找不到 CLI（包括只装了编辑器启动器的情况）时返回 `notInstalled`，不启动 SDK。
- 然后启动一个 `prompt: ""` 的探测 query，调用 `getAvailableModels({ fetchStrategy: "cache" })`，结束后 close。探测失败时经 `mapQoderException` 返回 `unavailable`。
- 缓存以 cwd 为 key（没有 cwd 时 key 为 `""`），没有 TTL，只缓存 ready 结果。`refresh` 只清除 Adapter 层缓存，SDK 仍然使用 `"cache"` 策略，不会强制联网刷新。
- 模型目录 `parseQoderModelCatalog` 保留 SDK 返回的模型和顺序，**不按 `isEnabled` 过滤**，能否选择由原生接口决定。SDK 没有返回模型时目录为空。`QODER_STANDARD_MODELS` 目前没有被任何代码引用。
- 当前 inspect 固定声明：`selectPermissionMode: true`、`permissionModeScope: "live"`、`fork: true`、`forkAcrossCwd: false`、`rollbackLastTurn: true`；只有目录里有 Thinking 选项时才声明 `selectThinkingOption`。

## open 与 Session 启动

- `create`：Adapter 用 `randomUUID()` 生成 sessionId，作为 SDK 的 `sessionId` 传入。`resume`：传 `resume: nativeSessionId`，不传 `sessionId`。
- **`QoderSession` 在构造函数里就调用 `queryFactory` 启动 SDK query**，同时开始消费消息、拉取 `supportedCommands()`、刷新 Usage。这与 claude-code 的懒启动不同，open 成功就意味着原生进程已经启动。
- create 时的 Thinking 通过 `extraArgs["reasoning-effort"]` 传入。权限为 `bypassPermissions` / `yolo` 时附加 `allowDangerouslySkipPermissions: true`。
- `executionPolicy: "unattended-full-access"` 映射为 `bypassPermissions`。如果同时显式传了其他权限模式（`bypassPermissions` / `yolo` 以外），返回 `invalidRequest`，且在启动 SDK 之前拒绝（测试 “rejects conflicting permissions before starting the SDK”）。
- `mapToQoderPermissionMode` 除了目录里的五种（`default / acceptEdits / auto / plan / bypassPermissions`），还接受 `yolo`、`dontAsk`。这两个值不在对外目录中，不要把它们加进 UI 目录。

## Turn、取消、交互

- `turn.start`：有活动 Turn 时返回 `sessionBusy`。否则先发 `turn.started`，再把 `SDKUserMessage`（`uuid: "qoder-msg-<uuid>"`，多段输入用 `\n` 拼接）推入 `PushableInput`。
- `turn.cancel`：调用 `query.interrupt()`。interrupt 失败时回退 `cancellationRequested` 并返回错误，Turn 锁不释放。成功的回执也不算 Turn 结束，收到原生 result 之前 Turn 仍占用 Session，迟到的输出归属原 Turn（测试 “keeps the old Turn locked after the interrupt receipt until its native result”）。turnId 与活动 Turn 不匹配时直接返回 ok，不做任何操作。
- 消息流意外结束时，`#close` 以 `processExited`（retryable）结束活动 Turn、关闭挂起的交互和 Item、发布 `session.faulted`，此后的请求返回 `invalidState`。在第一个 Turn 之前收到原生认证失败 result，也会进入 fault 状态。
- `canUseTool` 桥接两类请求：`AskUserQuestion` 转成 Host Question。**Qoder 要求 answers 以完整的问题 prompt 文本为 key**，多选答案用 `", "` 拼接；取消时回 `deny`。其他工具转成 Host Approval。
- 诊断类系统消息（`model_queue_status`、`status`、`hook_*`、`task_*`、`files_persisted`、`mirror_error` 等）不会结束 Turn。

## 历史、Fork、Rollback

- `readSnapshot`：活动 Turn 期间返回 `sessionBusy`；否则调用 `getSessionMessages(id, { dir: cwd, view: "historical" })`，再经 `mapQoderSnapshot` 投影。`nativeTurnKey` 是用户消息的 uuid，checkpoint 是该 Turn 最后一条 assistant 消息的 uuid。
- **错误信息包含 not found / ENOENT 时返回空历史**：这是为了处理刚创建、还没落盘的会话，但也会把“resume 的会话已丢失”当成空历史返回。修改时要区分这两种情况，不要再扩大这种兜底。
- Fork：`getSessionInfo` 读到的 cwd 与目标不同时返回 `unsupported`；读取失败时忽略并继续。然后调用 `forkSession(sourceId, { dir, upToMessageId: checkpointId })`，错误信息含 not found / cannot find 时返回 `checkpointNotFound`。**当前没有 claude-code 那样的派生前缀校验和失败后删除派生会话**，这是已知差距。
- Rollback：源会话有 ≥2 个 Turn 时，fork 到倒数第二个 Turn 的 checkpoint（没有 checkpoint 时回退使用 `nativeTurnKey`）；只有 1 个 Turn 时，生成新的随机 sessionId 并以 create 方式打开，第一个 Turn 之前不会落盘（与 claude-code 的 pending 预留不同）；0 个 Turn 时返回 `invalidRequest`。

## 运行时配置

- `model.select`：优先调用 `query.request({ type: "set_model", model, reasoningEffort })`，没有 `request` 时回退 `setModel`；成功后发布 `session.state.changed`。
- `thinking.select`：同样通过 `set_model` 请求携带 `reasoningEffort`。
- `permissionMode.select`：调用 `query.setPermissionMode`，SDK 没有这个方法时返回 `unsupported`。
- **三者在活动 Turn 期间都返回 `sessionBusy`**。这与 `docs/architecture/harness-plugin-runtime.md`“运行中切换 Model / Thinking”的要求（不应因活动 Turn 拒绝 model/thinking 选择）不一致，属于代码落后于文档的现状。

## 错误映射（`qoder-errors.ts`）

- result 的 `error_code`：`105` 或 `terminal_reason: "auth_required"` → `authenticationRequired`；`430` → `unsupported`；`47902` → `invalidState`（Turn 数量上限）；`500` / `10408` / `10500` → retryable 的 `nativeFailure`；其余 → `nativeFailure` 并带 `diagnostic`。
- CLI 退出码：`41` 认证、`42` 参数错误、`44` / `54` 工具或沙箱失败、`52` 配置错误、`53` Turn 数量上限。
- `mapQoderException` 对普通异常按 message 做字符串匹配（not installed / auth / token / session not found / unsupported / protocol）。新增分类时优先使用 SDK 提供的结构化字段。

## 已知偏差（不要扩散）

- `initialState` 直接把请求的 Model（未指定时用 `QODER_DEFAULT_MODEL_REF` = `auto`）、Thinking（未指定时用目录默认值或 `medium`）和权限模式当作生效值上报，没有等待原生确认。
- `thinking.select` 在 SDK 没有 `request` 方法时，只更新本地状态，不调用原生接口。
- `QoderAdapter` 没有关闭状态：`close()` 之后仍然可以 `inspect` / `open`。
- 放入 `stderrTail` 的错误消息没有经过 `sanitizeDiagnosticTail`。
