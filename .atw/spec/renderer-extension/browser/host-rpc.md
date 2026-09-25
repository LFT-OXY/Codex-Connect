# 与 Host 的 RPC

Renderer 不自己开连接，而是复用 Desktop 为每个 Host 连接创建的 RequestManager（带 `sendRequest` 和可选的 `addNotificationCallback`），发送 `codexhost/*` 自定义 JSON-RPC。服务端实现在 `packages/host-runtime/src/app-server-host.ts`。

## 客户端写法（`renderer-model-client.ts`）

每个方法都按“校验入参 → 发送 → 校验结果”三步写，schema 全部来自 `@codexhost/shared-contracts`：

```ts
const params = threadUsageInspectionParamsSchema.parse(input);
const result = await manager.sendRequest(THREAD_USAGE_INSPECT_METHOD, params);
return threadUsageInspectionSchema.parse(result);
```

- 不要在 Renderer 里另写 schema，也不要对结果做 `as` 断言；需要新的数据形状时，先在 shared-contracts 里加 schema。
- `RendererModelClient` 中带 `?` 的方法（`listHarnessPlugins?`、`credentialImports?`、`subscribeCodexAccounts?` 等）是后来加入的能力。调用方先判断方法是否存在，缺失时显示明确的不可用状态，不能退化成空数据。
- `createRendererModelClient(candidates)` 只接受**恰好一个**带 `sendRequest` 的候选，否则返回 `null`，调用方必须处理 `null`。

## 方法名常量

- 大部分 `codexhost/*` 常量定义在 `renderer-model-client.ts`（`THREAD_FORK_METHOD`、`HARNESS_INSPECT_METHOD`、`UPDATE_*` 等），Host 侧 `app-server-host.ts` 用的却是字符串字面量，两边靠人工保持一致（已知重复）。
- 较新的方法把常量放在 shared-contracts，由 Renderer 和 Host 共用：`IDLE_RELEASE_SETTINGS_METHOD`、`CREDENTIAL_IMPORTS_METHOD`、`HARNESS_LAUNCH_SETTINGS_GET/SET_METHOD`、`LOADED_SESSIONS_METHOD`、`LOCAL_USAGE_QUERY_METHOD`（契约见 `.atw/spec/host-runtime/node/local-usage.md`；用量页与会话导入页一样固定走本地 Host）。**新方法沿用这种写法**，不要继续在 Renderer 里定义私有常量。
- 新增方法时需要同时改：shared-contracts 的常量和 schema、Host 路由、`RendererModelClient`，以及 `test/renderer-model-client.test.ts`。Host 与 Renderer 必须一起发布（`docs/architecture/external-thread-steering.md` 的“配套发布”要求）。

## 旧 Host 与不支持的方法（`renderer-request-sender.ts`）

- `createRendererRequestSender` 只识别 `codexhost/` 方法的“方法不存在”错误：`code === -32601`，或者 `-32600` 且 message 以 ``Invalid request: unknown variant `<method>` `` 开头。识别到后转成 `RendererMethodUnavailableError` 并按 sender 记忆，后续调用直接抛出。成功结果、参数和瞬时失败都**不缓存**。
- 调用方要区分“不可用”和“失败”：`renderer-idle-release-preference.ts` 发布 `"unavailable"` / `"failed"`；`renderer-binding-probe.ts` 把 unavailable 映射为 `code: "unavailable", retryable: false`。
- 官方 Codex 连接没有 `codexhost/thread/inspect`。`inspectThread` 在收到 `RendererMethodUnavailableError` 后回退到原生 `thread/read`，并且只有在 `modelProvider` / `cliVersion` 都不是 `codexhost` 时才认定为 Codex 所有。RPC 失败或字段缺失时抛错，**不能默认把 Thread 归给 Codex**。

## 调度优先级

`RendererRequestOptions.priority`（`"background" | "interactive"`）是 Desktop 的调度元数据，不属于 RPC params。后台发现类请求（如 `inspectHarness` 可用性探测）传 `{ priority: "background" }`；交互请求不要放进后台队列。转发时如果 `options === undefined`，就不要传第三个参数（`renderer-host-clients.ts` 与 `createRendererModelClient` 都这样处理）。

## 多 Host 路由（`renderer-host-clients.ts`）

- 客户端以 `hostId` 为键，路由来自 desktop-control 注入的 `window.__codexhostHostRoutingV1`（`forHost` / `forComposer`），与当前活动 Composer 无关。
- 每次发送前都要重新确认 `readRouting()?.forHost(hostId) === route`。Manager 被替换后，旧客户端可以完成进行中的请求，但不能再派发新请求。
- 每个 Manager 各自安装 `installRendererExternalQueue` / `installRendererExternalSteering`，Host 被 retire 时逐个清理；某个 cleanup 抛错时也要继续释放其余资源（`try/catch` 后继续）。

## 通知与异步竞态

- Desktop **不会**把自定义通知 `codexhost/thread/usage/updated` 分发给 Renderer 回调。用量刷新同时监听 `thread/tokenUsage/updated` 和 `turn/completed`（`THREAD_USAGE_REFRESH_METHODS` 上方注释）。依赖新通知之前，先确认 Desktop 真的会转发它。
- 订阅统一用 generation 计数来丢弃过期回调（`createThreadUsageSubscriptionRelay`）；探针中的异步结果也要先检查 `generation !== state.requestGeneration || disposed`，再写回状态。Host/Thread 切换或 Composer 重挂后，旧响应不能覆盖新目标。

## 非 RPC 的 Desktop 通道

语言设置经 `codex-locale-adapter.ts` 调用 `window.electronBridge.sendMessageFromView`（Desktop preload 暴露的运行时对象，不是 Electron import），只访问固定的 `vscode://codex/get-setting`、`locale-info`、`set-setting`，超时 750ms。不要借这个桥访问其他 URL。
