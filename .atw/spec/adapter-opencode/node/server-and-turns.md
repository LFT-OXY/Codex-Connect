# OpenCode 受管 Server、SSE 与 Turn

## 受管 Server（`server-connection.ts`）

- 所有权：`OpenCodeAdapter.open()` 为**每个** HarnessSession 创建一个 `OpenCodeServerConnection` 和一个 transport；`#inspectCwd()` 也会启动一个临时 Server，并在 `finally` 中关闭。Server 之间不共享。这样做有两个原因：原生 `always` 审批规则和 `OPENCODE_CONFIG_CONTENT` 都是进程级的，不应泄漏到其他 Session。
- 启动：`openCodeServerInvocation()` 固定 `serve --hostname=127.0.0.1 --port=0`。每次启动用 `randomBytes(32)` 生成密码，通过 `OPENCODE_SERVER_USERNAME=codexhost` / `OPENCODE_SERVER_PASSWORD` 注入。stdout 必须出现 `opencode server listening on http://127.0.0.1:<port>` 这一行（正则匹配），之后再过一次 `global.health()` 才算连接成功。启动超时默认 20 s。
- Server 进程的 cwd 不是工作区，而是 `safeOpenCodeServerCwd()` 按 `USERPROFILE`→`HOME`→`homedir()`→`tmpdir()` 顺序选出的第一个可读写目录。工作区通过 SDK client 的 `directory` 参数按请求传递（`client(cwd)`）。
- 进程退出后 `#connection` 置空，下一次 `client()` 会重新拉起 Server；`close()` 只执行一次，关闭进程树（POSIX 下 detached 进程组）。

## SDK transport（`sdk-transport.ts`）

- 命令超时默认 15 s。SDK 响应统一走 `responseData()` / `responseAccepted()`：有 `error` 就分类（包含 unauthorized/authentication 字样的归为 `authenticationRequired`，其余归为 `unavailable`）；成功但缺 `data` 时报 `protocolError`。
- SSE：`#pumpEvents()` 订阅 `client.event.subscribe`。一次连接必须先收到 `server.connected` 才算有效；断开后最多重连 3 次（间隔 500 ms），超过次数就 `onFault`。
- `OpenCodeTransport`（`protocol.ts`）是测试注入点：`opencode-adapter.test.ts` 通过 `OpenCodeAdapterDependencies.createConnection/createTransport` 注入假实现，不要在测试里起真实 Server。

## Turn 准入与完成（`OpenCodeHarnessSession`）

- 附着：`start()` 先订阅 SSE，再检查 `getStatus()`，状态不是 `idle` 就拒绝附着（“already busy and cannot be attached safely”）。
- 提交：`promptAsync({ sessionID, model?, variant?, parts: [text] })` 不带 `messageID`。先订阅、后提交，不会漏掉本 Turn 的事件。
- 归属证明：`message.updated` 中的 user 消息只记入 `#knownUserMessageIds`。只有 Assistant 消息的 `parentID` 能把它绑定到本 Turn（`#bindUserMessage`）；`message.part.*` 只投影 `assistantMessageIds` 中已有的消息。`message.part.delta` 先不判断类型，要等 `message.part.updated` 确定 text/reasoning 后再投影。
- 完成条件（`#reconcileAndFinish`）：原生状态回到 `idle`，**并且**读取 transcript 后能找到本 Turn 的 Assistant 已经 `time.completed`、`finish` 或 `error`。HTTP 204、一次 delta 或短暂静默都不算完成。
- 取消：`#cancel()` 只调用原生 `abort` 并返回 `cancellationRequested`，Turn 终态要等 native idle 之后才发出。如果原生没有写入 Assistant 终态，本次按 cancelled 结束，但冷读时仍如实显示原生的 unknown 状态。`MessageAbortedError` 在已请求取消时映射为 cancelled。
- 重连对账（`#reconcileAfterReconnect`）：第二次及以后收到 `server.connected` 时，读取 status、`question.list`、`permission.list`，补开仍挂起的交互，把已从列表消失的交互以 `superseded` 关闭；如果已经 idle，就进入完成对账。
- 压缩：命令目录只有 `opencode.compact`（`/compact`，无参数），调用原生 `session.summarize`。

## Question 与 Approval

- Question 映射为 Host `choice`，原生 `custom` 映射为 `allowOther`。OpenCode Question 没有 secret/multiline 语义，不要声明这两项。回复前先用 `validateHostQuestionResponse` 校验；用户取消时调用 `rejectQuestion`。
- Approval 只提供 `allow-once` → `once` 和 `deny` → `reject` 两个动作（`#openApproval`）。

## Permission Mode 与执行策略（`permission-modes.ts`、`managedOpenCodeEnvironment`）

- 三种模式：`default`（使用 OpenCode 配置）、`ask`、`allow`（`dangerous`）。`ask`/`allow` 写入 Session 原生 `permission` 规则集，形式为 `{ permission: "*", pattern: "*", action }`。`requestedPermissionRules()` 只替换本 Adapter 写入的通配规则，保留用户的其他规则；`permissionModeFromSession()` 从后往前找最后一条通配规则来回读当前模式。规则随 Session 持久化，跨 Resume 保留。
- `executionPolicy = "unattended-full-access"`：create 时必须是 `allow`，否则返回 `unsupported`。同时在该 Server 进程环境的 `OPENCODE_CONFIG_CONTENT` 中合并 `permission: "allow"`；已有值不是合法 JSON 对象时直接失败，不覆盖。执行策略保存在 Native Ref 的 `locator.executionPolicy` 中，resume/fork 时由此恢复。
- `build`/`plan` 是 OpenCode Agent，不是 Permission Mode，不要混用（领域术语表）。

## Model 与 Thinking（`model-catalog.ts`）

- Model Ref：`opencode-model-v1.` 前缀，编码 `providerID/modelID`，只列出已连接 Provider 的模型。create 请求的 Model 不在目录中时报 `protocolError`。
- Thinking 对应模型的 variant：id 为 `ocv.` + base64url(variant)，`ocv.default` 表示不指定。只有目录中选项多于 1 个时才声明 `selectThinkingOption`。create 时只给 Thinking、不给 Model 会返回 `invalidRequest`。
