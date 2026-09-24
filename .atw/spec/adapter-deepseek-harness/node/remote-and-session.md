# DSH：托管 Web Remote、控制投影与 Session

## 托管进程与认证（`modern/remote-connection.ts`、`modern/wire.ts`）

- 每个 `ModernDeepSeekHarnessAdapter` 对应一个 `ModernRemoteConnection`，也就对应一个 `dsh web --no-open --host 127.0.0.1 --port 0` 子进程（POSIX 下 `detached`，以进程组方式启动）。所有 Session 共用这一个进程。
- 就绪判断：stdout 必须输出规范的 `dsh web: http://127.0.0.1:<port>/?token=<43 位 base64url>`（`parseLaunchUrl`）。就绪输出上限 16 KB，启动超时 20s。
- 认证：GET 启动 URL，要求返回 `303` 且 `Location` 为 `/` 或 `./`，然后从 `Set-Cookie` 解析出 `dsh-auth-*` 会话 Cookie（`parseSessionCookie`）。之后每个请求都带这个 Cookie。token 和 Cookie 都不能进入日志或错误，统一经过 `redactModernCredential`。
- unary 调用：`POST /api/<endpoint>`，请求体为 `{ type: "client-request", rpcId, method, payload: { args } }`，`redirect: "manual"`，默认超时 10s。响应为 401/403 时报 `authenticationRequired`，返回 3xx 时报 `protocolError`。`timeoutMs: null` 只留给由生命周期控制的长操作，调用方必须同时传入 `AbortSignal`，否则抛 `TypeError`。
- 流：WebSocket 连接 `/api/remote.mux`（`MODERN_REMOTE_MUX_PATH`），帧类型为 `item | error | end`。每条流有一个有界 inbox（4096 帧 / 32 MB），溢出就报 `protocolError`，不静默丢帧。
- stderr 只保留有界的尾部（16 KB，截断时对齐到空白字符）并做脱敏，用作诊断。
- 进程意外退出时，在 `exit` 回调里**立即**开始清理进程树（“before a stale PID can be reused”），再通过 `onFault` 通知所有订阅者；某个订阅者抛异常不能妨碍其余 Session 收到通知。
- 外部 Web 实例：如果配置的端点上已经有 DSH Web 在运行，本包不会借用它（不接受外部凭据）。门面会用无凭据的 GET 比对精确的 401 指纹，然后提示用户关闭该实例（`generation-selector.ts`）。带 `?token=` 的 bootstrap URL 不能作为端点使用。

## 使用的 Remote 端点（全部在本包内）

| 端点 | 用途 | 位置 |
|---|---|---|
| `session/create` / `session/fork` / `session/list` | 创建、Fork、导入候选 | `modern/deepseek-harness-adapter.ts`、`session-list.ts` |
| `session/follow`（流）+ `session/page` | 日志快照 + 实时后继事件 | `modern/journal.ts` |
| `session/control`（流，Adapter 级） | `modelSelection` / `permissions` 等权威投影 | `modern/control-store.ts` |
| `$events`（流）+ `$events/result` | 审批与用户问题（waterfall） | `modern/event-gateway.ts` |
| `session/prompt`（`mode: "queue"`）/ `session/cancel` | Turn 开始与取消 | `modern/session.ts` |
| `session/selectModel` / `session/modelCatalog` | Model 与 Thinking | `modern/configuration.ts`、`catalog.ts` |
| `settings/describe` + `commands/execute "/permission <id>"` | 权限目录与切换 | `modern/permission-modes.ts`、`configuration.ts` |
| `session/updateQueue`（`action.kind: "remove"`） | 清理 Fork 继承的待办 | `modern/fork-inbox.ts` |
| `HEAD /api/session.export?sessionId=…&includeDescendants=false` | 等待原生批量写入落盘，不下载内容 | `flushSession` |

## 控制投影与配置（`control-store.ts`、`configuration.ts`、`permission-modes.ts`）

- `ModernControlStore` 独占 Adapter 级的 `session/control` 流，按 Session 保存投影行（带 `seq`）。打开 Session 时先 `attach`，读完日志后用 `journal.projections` 执行 `seed`。
- **配置成功的判定标准是：投影中出现比变更前更高的 seq，且值与请求精确一致**（`selectModernModel`、`selectModernPermissionMode`、`waitForPermissionMode`）。unary 回执只说明请求已被接收。传输结果不确定时（`isUncertainTransportFailure`），同样等待投影来确认，不直接报失败。
- Model Ref 为 `deepseek-harness-model-v2.` + base64url(JSON `[provider, model]`)，解码后必须重新编码一致（`model-catalog.ts`）。Thinking 选项只取当前 Model 路由声明的 `reasoning.efforts`。
- 权限目录来自 `settings/describe` 中 `permission` 命名空间的 Schemastery Schema（`@deepseek-ai/schemastery`）；没有这个命名空间时，`selectPermissionMode` 能力为 `false`。
- 无人值守创建：打开后必须能从日志中确认 `permission/preset` 与 `sandbox/mode` 都是 `danger-full-access`，且 `approval/policy` 为 `never`（`delegationPermissionIsApplied`），否则报 `nativeFailure`。
- Model / Thinking 在 Turn 进行中也可以切换（提交 `03eefc95`）。

## 审批与问题（`event-gateway.ts`）

- 一个 Adapter 只有一个 `ModernEventGateway`，服务所有已加载的 Session。事件流中断时 `onGenerationLost` 允许**恰好一次**替换（`#eventReplacementUsed`）；第二次中断会让整个 Adapter 进入失败状态。
- 审批只提供 `allow-once` 与 `reject` 两个动作（`session.ts`），因为原生结果只有 `allowed-once | rejected | cancelled | unavailable`，没有“本会话内始终允许”。
- 问题取消通过 `delivery.reject()` 完成。回答提交后，如果 Interaction 已经被替换或 Session 已关闭，返回 `invalidState`。

## Prompt 关联与 Turn（`session.ts`）

- 每个 Prompt 生成一个 `requestId`，通过日志中持久化的 requestId 回显把 Host Turn 与原生 Turn 关联起来。关联边界事件见 `CORRELATION_BOUNDARIES`（`request/header`、`assistant/*`、`tool/*`、`step/end`、`turn/end`）。
- **不确定结果的 Prompt 绝不重发**：unary 失败时进入 `MODERN_PROMPT_CORRELATION_GRACE_MS`（5s）宽限期，等待 requestId 回显；等不到就让 Session fault。已接收的 Prompt 最多等待 `MODERN_ACCEPTED_CORRELATION_TIMEOUT_MS`（300s）完成关联。
- 能力 `autonomousTurns: { observe: true }`：DSH 可以自己发起 Turn（队列、团队消息等），Session 会观察并投影这些 Turn。未关联的自主 Turn 的终态不能用来结束另一个 Host Turn。
- Assistant 流（V3/V4）：实时增量先展示，最终以持久化的 `assistant/message` 为准。放弃或重试的尝试会把已展示的临时 Item 标记为 cancelled，失败尝试的文本不能拼进成功答案。重连后按原生 Assistant baseline 去重。流末尾的换行先暂存，由最终消息决定（`docs/harnesses/deepseek/dsh-edit-recovery.md`）。
- 命令：静态目录只有 `/compact`、`/dsh-goal`、`/plan`（`harness-commands.ts`），通过 `commands/execute` 发送完整命令行执行。`/compact` 的结果按 DSH 原文精确匹配：`DSH_COMPACT_BUSY` 映射为 `sessionBusy`，`DSH_COMPACT_CANCELLED` 映射为 cancelled，其余失败映射为 `nativeFailure`。这是依赖原生文案的脆弱点，DSH 一改措辞就会退化成 `nativeFailure`，升级版本时要复核。

## 取消、关闭与落盘确认

- `session/cancel` 的回执只表示取消请求已被接收。必须继续消费日志，直到看到对应的 `turn/end`，才能认定原生执行已停止（`#close` 注释）。
- 关闭一个仍有活动 Turn 的 Session：先请求取消，再在 `NATIVE_CLOSE_TIMEOUT_MS`（5s）内等待 `turn/end`；确认不了就让 close 失败，不能假装已经停止。Prompt 还没关联上时也无法确认停止，同样报错。Session 先 fault 再 close 时，本地清理不能当作原生已停止的证据。
- V3/V4 在正常关闭和 Fork 队列清理之后，会调用 `flushSession`（认证的 `HEAD /api/session.export`），等待原生 200ms 批量写入完成。Windows 上在结束托管进程之前尤其不能省略这一步，否则冷恢复会重放已经回滚的输入。持久化确认失败时明确报错，**不能用固定延时替代**。
