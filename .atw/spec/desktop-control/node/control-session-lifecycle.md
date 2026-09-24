# Control Session、生产 Controller 与附件协议

## 两条控制路径：不要混用

| 路径 | 入口 | 连接对象 | 使用方 |
|---|---|---|---|
| Renderer CDP（**生产**） | `renderer-cdp-control-session.ts` 的 `installRendererCdpControlSession` | Renderer 页面的 `--remote-debugging-port` HTTP 发现，再连 page target 的 WebSocket | `production-controller.ts` |
| Electron 主进程 Inspector | `renderer-control-session.ts` 的 `installRendererControlSession` | `/json/list` 中 `type === "node"` 的 target，在主进程里 `webContents.executeJavaScript` | `tools/renderer-binding/run.mjs`、`tools/codex-desktop-contract-audit/run.mjs`（`inspectDesktopContracts`） |

标题隔离策略（`main-process-title-policy.ts`）、Renderer reload 和 `readTitlePolicyCounters` 只存在于 Inspector 路径。生产 Controller 不安装它们，不要假设生产环境里有 `__codexhostMainProcessTitlePolicyV1`。两个 session 文件各有一份 `ProductionRendererStatus`、`validateBindingStatus`、`sameAgents`、`RendererAdapterReadinessError`，内容相同。修改 binding 校验时两处要同步。

## CDP 客户端（`cdp-client.ts`）

- 所有端点都必须是 loopback（`127.0.0.1` / `localhost` / `[::1]`），HTTP 发现和 `webSocketDebuggerUrl` 都会校验（`loopbackUrl`）。
- `listCdpTargets` 会**跳过**缺少 `id`、`url` 或 `webSocketDebuggerUrl` 的 target，不会让整次发现失败。过去一个 worker 曾让健康检查每次都失败，并触发整次 Renderer 重注入（#371，见 `parseTarget` 注释）。
- 命令和连接的默认超时都是 10s。`close()` 或 socket 断开时，所有 pending 命令都会被 reject。`evaluate()` 固定使用 `awaitPromise + returnByValue`，遇到 `exceptionDetails.text` 直接抛出。
- 可测试性通过注入 `CdpFetch` / `CdpSocketFactory` 实现，不引入 `ws` 等依赖（Node 22 自带全局 `WebSocket` 和 `fetch`）。

## Renderer CDP Session 的安装顺序

`installTarget` 的顺序是固定的（测试 “registers future-document injection before evaluating the current document”）：

```ts
await renderer.command("Runtime.enable");
await renderer.command("Page.enable");
await renderer.command("Page.addScriptToEvaluateOnNewDocument", { source: rendererSource });
await evaluateSource(renderer, rendererSource);
const draftPrewarmPolicy = await operations.installDraftPrewarmPolicy(renderer);
const binding = await waitForBinding(renderer, enabledAgents, timeoutMs, pollIntervalMs);
```

- Target 只接受 `type === "page"` 且 URL 恰好为 `app://-/index.html` 的页面（`selectPrimaryRendererTarget`）。存在多个候选时，优先已拥有的 target id。
- Binding 就绪的判断依据是 `window.__codexhostRendererBindingProbeV1?.status()`：`version: 2`，`enabledAgents` 与期望的**成员集合**相同但忽略顺序（Renderer 决定展示顺序，#369 修复了顺序漂移导致的反复重注入），并且 `adapter.state === "ready"`。`installing` 会继续轮询，其他状态抛出 `RendererAdapterReadinessError`，fail closed。
- `ensureInstalled()`：target id 变化时，先完整安装新 target，再关闭旧连接；替换失败时保留旧 snapshot（测试 “does not replace the installed snapshot when replacement installation fails”）。target 相同时，binding 为 `null` 就重新 evaluate；必须**先**重装草稿策略，再校验 readiness，因为 Host 切换会让 Adapter 暂时处于 installing（代码注释）。任何异常都降级为整次重装。

Inspector 路径的顺序是：`installTitlePolicy` → `reload` → 等待同一个 webContents → `markTitlePolicyReady` → 执行 Bundle → 草稿策略 → binding（测试 “owns the fixed policy, reload, injection, and recovery order”）。选择 webContents 时只选 `type === "window"`、非 `avatar-overlay`、`elementCount > 0` 的窗口，并优先已拥有的 id，不按窗口大小切换。

## 生产 Controller（`production-controller.ts` / `release-main.ts`）

- **参数严格**：每个参数只能出现一次，未知参数直接报错。`--renderer-cdp-endpoint` 必须是带显式端口的 loopback `http:` origin，`--renderer` 必须是绝对路径，`--default-agent` 只能是 `codex|pi`，`--attachment-nonce` 必须是 32 位小写 hex。
- **注入源拼接**：注入内容依次为 `RENDERER_CSP_BOOTSTRAP`（设置 zod `jitless`，以适配 Desktop CSP）、`__codexhostProductionConfigV1`（只含 `defaultAgent`）、Renderer Bundle。`enabledAgents` 是固定的 16 项列表，必须与 `renderer-extension/src/agent-selection-state.ts` 的 `KNOWN_RENDERER_AGENTS` 一致（`tests/release/production-renderer.test.mjs` 会校验）。`docs/architecture/harness-plugin-architecture.md` 已把它列为待动态化的重复名单。
- **启动**：首次安装超时 90s。遇到 `Execution context was destroyed` / `Promise was collected`（沿 `cause` 链最多查 4 层）时重试 3 次，每次间隔 250ms。首次安装失败**不是致命错误**，仍会启动附件服务器并发布 readiness，之后在 30s→300s 指数退避下后台恢复。
- **串行化**：所有 session 操作都经 `useSession` 的 Promise 队列执行，附件回调与 500ms 监控循环不会并发操作 CDP。恢复失败时调用 `resetSession()`，关闭旧 session。
- **Readiness**：附件服务器监听后才会向 stdout 写一行 `{"schemaVersion":2,"state":"compatible","issues":[]}`，限制为 512 字节，且不允许额外字段。launcher 在 `crates/launcher/src/compatibility.rs` 做同样严格的解析。stdout 只用来输出这一行；诊断信息写 stderr，并且只在 `CODEXHOST_STARTUP_TRACE=1` 时输出。
- `release-main.ts` 在收到 SIGINT/SIGTERM 时 abort；未捕获错误打印为单行 `codexhost Desktop Controller: <message>`，并设置 `exitCode = 1`。

## 附件协议（`controller-attachment-server.ts`）

launcher 在重复启动时通过它唤醒已运行的 Desktop（`crates/launcher/src/desktop_attachment.rs`）：

- 只监听 `127.0.0.1`。请求是单行文本，最多 96 字节，解析超时 5s。唯一接受的命令是 `ATTACH <nonce>`，响应为 `ready|busy|rejected|failed` 之一。
- **单飞**：已有 attach 在进行时，新请求回复 `busy`（launcher 按瞬态处理并重试），不会再往 Controller 队列追加工作。请求被接受后会取消 socket 超时；客户端断开后恢复仍会继续（测试 “keeps recovery alive after its client disconnects…”）。
- 回调失败只回复 `failed`，不暴露错误细节。已退役的 `COMPATIBILITY_UPDATE` 和 quit 命令回复 `rejected`，有专门测试锁定，**不要重新引入**。

## 错误处理

本包没有跨进程的错误结构：内部抛出描述性的 `Error`，错误消息就是诊断信息；只有 `RendererAdapterReadinessError` 是具名类型，用来区分“仍在 installing”与“fail closed”。对外只会输出 readiness 行、附件响应词和 stderr 单行错误。修改错误消息时，先搜索 `production-controller.ts` 的 `isTransientRendererInstallError` 以及 `renderer-draft-prewarm-policy.ts` 对 `"Renderer request manager is ambiguous"` 的字符串匹配。这两处都依赖消息文本。
