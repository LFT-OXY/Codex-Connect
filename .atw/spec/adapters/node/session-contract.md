# HarnessAdapter / HarnessSession 的实现约定

权威定义：`packages/harness-adapter/src/text-session.ts`（接口），`packages/shared-contracts/src/harness-models.ts`（`harnessInspectionSchema`、`harnessSessionCapabilitiesSchema`）。本文只写 Adapter 里反复出现的实现方式，以及必须遵守的规则。

## 类的形态

- 构造签名一般是 `constructor(options: XxxAdapterOptions = {}, dependencies?: XxxAdapterDependencies)`：`options` 放 command、environment、超时等参数，`dependencies` 放 `createTransport` / `createInspector` / 原生 fork、读历史等函数，默认值指向真实实现。pi、claude-code、grok、kimi-code、opencode、omp、kiro-cli 都这样写。测试只替换 `dependencies`。Qoder 是例外，把 `queryFactory`、`forkSession` 等注入函数放在 `options` 里。
- Adapter 持有的状态：`#sessions: Set<Session>`（Session 关闭时通过 `onClosed` 回调把自己移出集合）、`#closePromise`、按 cwd 为 key 的 `#inspectionCache` + `#inspectionInFlight`，以及 inspect 用的临时 Transport 集合（pi 的 `#inspections`、claude 的 `#inspectors`）。
- Session 用 `type SessionPhase = "open" | "closing" | "closed" | "faulted"`（claude-code、grok、omp、opencode、pi 相同），用 `#active` / `#activeTurn` 表示正在运行的 Turn，并用 `readonly #channel = new HarnessOutputChannel<HarnessOutput>()` 输出事件，`this.outputs = this.#channel.outputs`。

## HarnessResult 与错误

- Adapter 和 Session 的公开方法**不向 Host 抛异常**。`open` / `execute` / `readSnapshot` 返回 `HarnessResult<T>`；`inspect` 用 `status` 为 `notInstalled` / `unavailable` / `error` 的失败结果。
- 每个包都有一个本地转换函数，把 unknown 异常转成 `HarnessError`：pi / omp 叫 `normalizedError(error, fallbackCode)`，grok / opencode 叫 `normalizeError`，deepseek 叫 `toHarnessError`，qoder 叫 `mapQoderException`。典型分支如下（`pi-adapter.ts`）：

```ts
if (isRecord(error) && error.code === "ENOENT") return { code: "notInstalled", ... };
if (error instanceof PiAdapterFaultError) return error.harnessError;   // 已分类的错误原样透传
if (error instanceof PiRpcUnsupportedCommandError) return { code: "unsupported", ... };
return { code: fallbackCode, message: errorMessage(error),
         retryable: fallbackCode === "unavailable" || fallbackCode === "nativeFailure" };
```

- 包内控制流用具名错误类（`PiAdapterFaultError`、`GrokTransportError`、`KimiExecutableError`），在公开边界转换。需要在 `open` 深处返回精确错误码时，就抛一个带 `harnessError` 的 FaultError（pi 的写法）。
- 错误码语义：跨 Harness 的 ref、非法 Model/Thinking/Permission 用 `invalidRequest`；checkpoint 不属于源会话或不在当前分支用 `checkpointNotFound`；resume 后原生身份不一致用 `sessionNotFound`；已关闭或已 fault 用 `invalidState`；并发冲突用 `sessionBusy` 且 `retryable: true`；原生不支持用 `unsupported` 且 `retryable: false`。
- stderr 先经过 `sanitizeDiagnosticTail`，再放进 `stderrTail`。inspect 失败时要带上 `stage`、`durationMs`（`pi-adapter.ts#inspectCwd` 按 spawn → startup → model-catalog → capabilities 逐步更新 `stage`）。

## inspect

- 用一个临时 Transport 读取 Model 目录和能力，读完在 `finally` 里关闭。不创建用户 Session，也不发送 Prompt。
- 缓存 key 是 cwd。同一 cwd 的并发请求共用同一个 Promise；只缓存 `ready` 结果；`refresh: true` 绕过缓存；Adapter 关闭后返回 `invalidState`（claude 测试 “coalesces concurrent inspection and does not cache failures or unsupported capability”）。
- `ready` 结果必须能通过 `harnessInspectionSchema`：`selectPermissionMode` 为 true 当且仅当提供 `permissionModes` 目录；`forkAcrossCwd` 为 true 时 `fork` 也必须为 true。
- inspect 返回的 capabilities 要和 Session 的 `capabilities` 一致。两处各写一份字面量是现状（claude-code 第 501 行和第 2740 行，omp 第 640 行和第 2284 行）。修改时两处要同时改，或者抽成常量（codebuddy `configuration.ts`、grok 的函数）。

## open 的四个分支

以 `PiAdapter.open` 为模板，顺序是**先校验、后产生副作用**：

1. `#closePromise` 已存在时返回 `invalidState`；`cwd` 为空时返回 `invalidRequest`。
2. `create`：解码 `model`（`decodeXxxModelRef`）、校验 `thinkingOptionId` 和 `permissionModeId`，任一失败都返回 `invalidRequest`，这一步不创建进程。许多 Adapter 的 create 路径延迟到首个 Turn 才启动 Transport（claude 测试 “opens and closes unused Sessions without creating a Transport”，pi 测试 “does not create a transport for unused prewarm”）。
3. `resume` / `fork` / `rollbackLastTurn`：先用 `nativeSessionRefSchema.parse` 解析 ref，再检查 `harnessId === this.harnessId`。fork 还要检查 `checkpoint.harnessId` 和 `checkpoint.nativeSessionId === sourceRef.nativeSessionId`。resume 启动后比对原生返回的 sessionId，不一致时报 `sessionNotFound`，不能静默建一个新会话。
4. 任一分支失败时，在 `catch` 里 `await transport?.close()`，再返回规范化后的错误。
5. 每个实际打开路径都要把 `input.environment` 传给原生进程；有值时它是该 Session 的完整环境（Host 在其中注入 `CODEXHOST_THREAD_ID` 等委派变量），不要反过来被工厂环境覆盖。各包都有这类测试，例如 “passes per-Session delegation environment to the … transport”（pi、grok、claude-code）和 opencode 的 “preserves environment scope across create, resume, fork, and rollback”。

### executionPolicy

`create.executionPolicy === "unattended-full-access"` 表示 Host 的执行意图，不是 Permission Mode。现有映射：claude-code → `auto`，grok → `always-approve`，omp → `yolo`，qoder → `bypassPermissions`，hermes → `dont_ask`。kimi-code、kiro-cli、cursor-cli 无法确认原生已生效，返回 `unsupported`。Pi 原生没有权限模式，不做任何处理（测试 “does not translate execution policy into Pi permission options”）。显式传入的 permissionModeId 与该意图冲突时，要拒绝（qoder、hermes）。

## Model / Thinking / Permission 的编码

- Model Ref 对 Host 是不透明的：`<harness>-model-v1.` + base64url 编码的原生值（claude-code、pi、omp、opencode、qoder；deepseek 用 `-model-v2.`）。`decode` 在前缀不属于本 Harness 时直接抛错，这样别的 Harness 的 Ref 进来会被拒绝，不会被误用。
- `initialState` 和 `session.state.changed` 应当只报告原生已确认的值，不能把请求值当成生效值上报。未指定 Model 或 Thinking 时省略，让原生默认值生效。配置写入等原生确认后才返回 `completed`（opencode 测试 “does not publish a Permission Mode / Model selection when native persistence fails”）。
- 活动 Turn 期间收到 `model.select` / `thinking.select` 不要直接拒绝，按 `docs/architecture/harness-plugin-runtime.md` 的“运行中切换 Model / Thinking”处理。第二个 `turn.start` 和历史操作仍然返回 `sessionBusy`。

## Session 输出与命令

- `HarnessOutputChannel` 只允许一个消费者，重复迭代会抛错。`end()` 之后 `emit` 返回 false。`close()` 和进入 fault 状态时都要 `end()`。
- `turn.start` 返回 ok 只表示已接受，终态通过 `turn.completed` 事件给出。被拒绝的 Turn 不能发出任何 Turn 生命周期事件（pi 测试 “rejects startup before Turn acceptance without lifecycle events”）。
- `turn.cancel` 的回执不是 Turn 的结束边界：原生终态到达前 Turn 仍然占用 Session，迟到的输出仍归属原 Turn（qoder `qoder-sdk-transport.ts` 第 1279 行注释，pi 的 abort 测试）。
- Session 的 `commands` 与 Adapter 的静态 `commandCatalog` 分开：静态目录不能连接原生进程。进程启动后能列出更多命令的 Adapter 设置 `liveCommandCatalog = true`（pi、claude-code、qoder），用 `@codexhost/harness-adapter` 的 `isExcludedLiveCommand` / `mergeLiveHarnessCommands` 过滤。
- `close()` 用 `#closePromise` 保证幂等。Adapter 的 close 要等待 `Promise.all([...importRequests, ...inspections.close(), ...sessions.close()])`，并 abort 正在进行的 import 扫描（pi、claude-code）。

## 能力如实暴露

`docs/harnesses/capability-boundaries.md` 规定：原生没有的能力不在 Host 里模拟。现状如下：

| 能力 | 如实为 false 或受限的例子 |
|---|---|
| Permission Mode | pi 设 `selectPermissionMode: false`，create 带 `permissionModeId` 时返回 `unsupported`（测试 “does not manufacture a Permission Mode capability”） |
| Fork / Rollback | hermes ACP 路径三项全是 false；cursor-cli 由 `cursorForkAvailable()` 按平台决定 |
| 跨 cwd Fork | claude-code、qoder、kimi-code、opencode、codebuddy 都是 `forkAcrossCwd: false`，遇到不同 cwd 返回 `unsupported`；pi、omp、grok、kiro-cli、antigravity 支持 |
| 上下文压缩 | antigravity 不发送“请总结”Prompt 冒充压缩；cursor 不把普通 `/compact` Prompt 当作压缩 |

插件不支持某个 `OpenSessionInput` 分支时，保留这个分支，在产生副作用之前返回 `unsupported`。

## Fork 与 Rollback 的常见实现

- **原生 fork + 前缀校验 + 清理**：`claude-code/src/claude-fork.ts` 调 SDK 的 `forkSession(upToMessageId)`，然后同时读取派生会话和源会话的快照，比较派生会话是否恰好等于源的前缀、源是否保持不变、派生会话的原生 ID 是否与源不重叠。不满足时 `deleteSession` 删除派生会话，并返回 `protocolError`。grok 的做法相同（测试 “maps Method Not Found to unsupported Fork and deletes an inexact child”）。
- **Rollback = fork 到倒数第二个 Turn**：claude-code、qoder、opencode。源会话只有 1 个 Turn 时，需要得到一个空的可继续会话：claude 在 `CLAUDE_CONFIG_DIR/codexhost/pending-sessions` 写入预留记录，pi 用 `persistEmptyPiSession` 落盘后再 resume，qoder 直接生成一个新的随机 sessionId。
- 源会话正在运行 Turn 时，rollback 返回 `sessionBusy`（claude `blocksRollback` / `prepareRollback`，cursor `lockForFork`）。
- Fork 只作用于会话上下文，不回滚工作区文件。

## 传输层分类（选参考实现时用）

| 类型 | 代表 | 要点 |
|---|---|---|
| 原生 SDK | claude-code、qoder、opencode（`@opencode-ai/sdk` + `opencode serve --port=0`） | SDK 负责 spawn；通过 `spawnClaudeCodeProcess` 或 `pathTo…Executable` 注入发现到的可执行文件 |
| 原生 JSONL RPC 子进程 | pi、omp、hermes gateway | 进程生命周期、帧解析、超时都在 `*-rpc-session.ts` / `gateway-transport.ts` 里自己管 |
| ACP | grok、kimi-code、kiro-cli、cursor-cli、codebuddy、workbuddy、hermes（旧引用） | `ClientSideConnection` + `ndJsonStream`；ACP 的标准能力与各家私有扩展（如 grok 的 fork、rewind 方法）要分开处理 |
| stream-json CLI | antigravity | 每个 Turn 启动一次 CLI，历史由插件自己持久化 |
| 本地服务 + WebSocket | deepseek-harness | `modern/remote-connection.ts`；`profiles/` 按原生版本选择行为 |
