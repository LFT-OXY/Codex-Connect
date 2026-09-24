# 运行侧划分与注入代码规则

本包所有源码都是 `src/*.ts`，由 `tsc -b` 编译为 Node ESM。但运行位置有三种：Node 进程、Electron 主进程，以及 Renderer 页面。后两种代码由 Node 侧拼成字符串，再通过 CDP `Runtime.evaluate` / `Runtime.callFunctionOn` 送进去执行。

## 文件归属

| 运行侧 | 文件 / 符号 | 送达方式 |
|---|---|---|
| Node（Controller 进程与开发工具） | `cdp-client.ts`、`production-controller.ts`、`release-main.ts`、`controller-attachment-server.ts`、`renderer-cdp-control-session.ts`、`renderer-control-session.ts`，以及 `contract-audit.ts`、`renderer-dom.ts`、`main-process-title-policy.ts`、`renderer-draft-prewarm-policy.ts` 的外层函数 | 直接执行 |
| Electron 主进程 | `renderer-control-session.ts` 的 `electronModuleExpression`、`inspectElectronWebContents`、`activateElectronDesktop`、`executeInWebContents`；`main-process-title-policy.ts` 的 `INSTALL_POLICY_FUNCTION`；`renderer-draft-prewarm-policy.ts` 的 `mainProcessInstaller` | 通过 Inspector 连接的 Node target 执行字符串 |
| Renderer 页面（浏览器） | `renderer-react-ownership.ts`（`committedReactAncestors`）、`renderer-host-discovery.ts`（`requestManagerFromHookState`、`discoverRendererHosts`、`resolveRendererHostManager`）、`renderer-host-response-ownership.ts`、`renderer-draft-prewarm-runtime.ts`（`createDraftPrewarmPolicyBridge`）、`renderer-host-routing.ts`（`installRendererHostRouting`） | 先用 `Function.prototype.toString()` 序列化，再由 `directRendererInstaller()` 拼成一个 IIFE |
| Renderer 页面（字符串表达式） | `renderer-dom.ts` 的 `rendererStructureExpression`、`contract-audit.ts` 的只读审计表达式、`production-controller.ts` 的 `RENDERER_CSP_BOOTSTRAP` 和 `__codexhostProductionConfigV1` 前缀 | 字符串 evaluate |
| Renderer Bundle 直接导入 | `renderer-bindings.ts` 导出的 `committedReactAncestors`，以及 `RendererHostRoute` / `RendererHostRouting` 类型 | 由 renderer-extension 的 esbuild（`platform: "browser"`）打包进去 |

`renderer-draft-prewarm-policy.ts` 会把同一份浏览器实现分别用于两条传输路径：`installRendererDraftPrewarmPolicyDirect` 走 Renderer CDP 直接 evaluate；`installRendererDraftPrewarmPolicy` 走主进程，调用 `webContents.fromId(id).executeJavaScript(...)`。代码注释写明：“Do not maintain a second manager-discovery path through Inspector object IDs”。新增逻辑只写浏览器实现一份，不要为 Inspector 路径另写一套。

## 被序列化注入的函数：规则

1. **自包含**。函数体只能引用参数、自身内部定义的局部变量和浏览器全局。`isRecord` 这类 helper 要在函数体内重新定义，参见 `createDraftPrewarmPolicyBridge` 和 `retainRendererHostResponses` 开头。模块顶层的 import、常量和 helper 在序列化后都不存在。相关文件的注释都标注了 “Self-contained for Renderer injection / for injection”。
2. **依赖显式传参**。`installRendererHostRouting(root, target, discover, resolve, createPolicy)` 的依赖由 Controller 在 `directRendererInstaller()` 里传入。`discoverRendererHosts` 的默认参数引用了模块级 `committedReactAncestors`，只在 Node 测试中直接调用时生效。注入包装器总是显式传参，新调用点也必须显式传参。
3. **只用 `import type`**。例如 `renderer-host-routing.ts` 对 discovery 和 runtime 只有类型导入。如果需要值导入，只能加到 `directRendererInstaller()` 的 `const x = ${x.toString()}` 列表中，并作为参数传下去。
4. **重命名要同步**。改了导出函数名，就要同步修改 `directRendererInstaller()` 里的局部常量名和调用。release bundle 用 `minify: false`（`scripts/build-release.mjs`），不要改成压缩。
5. **幂等并可替换**。全局槽位统一用 `Object.defineProperty(target, "__codexhostXxxV1", { configurable: true, value })`。`installRendererHostRouting` 如果发现已有 `__codexhostHostRoutingV1`，直接复用；否则先 `dispose()` 旧的 `__codexhostDraftPrewarmPolicyV1`。策略变更后派发 `codexhost:draft-prewarm-policy-changed`，草稿工作区则发布到 `__codexhostDraftWorkspacesV1` 和 `codexhost:draft-workspace`（见 `docs/architecture/harness-command-integration.md`）。这些名字都被 `packages/renderer-extension/src/versioned-renderer-adapter.ts` 读取，属于跨包契约。

## 识别 Desktop 内部结构：按 API 形状，fail closed

- Request Manager 按方法形状识别：`requestClient.sendRequest/prewarmThreadStart/enqueueRequest`、`prewarmedThreadManager.discardAllPrewarmedThreads`，同时兼容 26.908 的 `{ hostId, manager, status }` 包装（`requestManagerFromHookState`）。候选不唯一时返回 `null`（`resolveRendererHostManager`），安装方会抛出 `Renderer request manager is ambiguous`，并在 60s 内有界重试。
- 历史事故见 `docs/archive/codex-desktop-incidents/26.814-compatibility-debt.md` 和 `26.908-request-manager-wrapper.md`：旧实现依赖 `Function.prototype.toString()` 和私有字符串查找 bridge，Desktop 更新后失效，相关代码已删除。**不要恢复按压缩类名或函数源码识别的做法。** 26.908 文档说 finder 在 `renderer-draft-prewarm-policy.ts`，实际已移到 `renderer-host-discovery.ts`，policy 文件只负责 re-export。
- 已知例外：`main-process-title-policy.ts` 仍通过 `ipcMain.listeners("codex_desktop:connect-app-host")` 的 `[[Scopes]]` 定位 WindowContext，并用 `generateTitle` 源码中的 `'Failed to generate thread title'` 校验签名。这是存量例外，不要扩大。
- React Fiber 只读取已提交的树（`committedReactAncestors`，遍历上限 `MAX_VISITED_FIBERS = 20_000`）。DOM 上的 Fiber 指针可能残留 alternate，不要缓存 manager，每次请求都重新 resolve（见 `renderer-host-routing.ts` 的 “never cache that entry”）。

## 其他约束

- 获取主进程 `electron` 的表达式（`process.mainModule.require`，失败时回退到 `createRequire(process.execPath)`）在 `renderer-control-session.ts`、`main-process-title-policy.ts`、`INSTALL_POLICY_FUNCTION`、`mainProcessInstaller` 中出现了 4 份。改动时逐一同步。
- 只读探针不得读取可见文本或输入值：`renderer-dom.ts` 只返回结构摘要，`contract-audit.ts` 通过 `strictKeys` 拒绝未知字段（测试 “rejects unknown fields and private values”）。
- `renderer-draft-prewarm-runtime.ts` 有 710 行，全部位于一个闭包内，还包含 Remote Control Host（`hostId` 以 `remote-control:` 开头）的桥接：通过 stock app-server 的 `process/spawn` 启动 PowerShell `-EncodedCommand` 桥进程，转发 `codexhost/*` 和外部 Thread 请求。这个文件已接近 800 行，**不要继续往里堆**。新职责应放进新的自包含模块，并通过 `directRendererInstaller()` 传入。
- 草稿策略只路由和转发：`codexhost/*` 请求原样透传给 Host，不在这里解释 Harness 语义。
