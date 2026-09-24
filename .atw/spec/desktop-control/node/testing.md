# 测试

vitest 使用 `environment: "node"`，没有 jsdom。测试不连接真实 Desktop，依赖都通过参数注入。

## 依赖注入点：用它们，不要 mock 模块

| 被测对象 | 注入点 |
|---|---|
| `runDesktopController` | `DesktopControllerDependencies`（`readRenderer`、`install`、`startAttachmentServer`、`ready`、`sleep`、`now`、`monitorIntervalMs`） |
| `createRendererCdpControlSession` | `operations: RendererCdpControlOperations`（`listTargets`、`connect`、`installDraftPrewarmPolicy`） |
| `createRendererControlSession` | `inspector` 和 `operations: RendererControlOperations` |
| `CdpClient.connect` / `listCdpTargets` | `CdpSocketFactory`、`CdpFetch` |
| `waitForRendererTitlePolicyReady` | `now`、`sleep` |

`production-controller.test.ts` 用假的 `sleep` / `now` 驱动监控循环和退避，不使用真实定时器。新增等待或重试逻辑时，也要把时间源放进依赖对象。

## 注入代码必须按“序列化后执行”来测

直接 import 函数并调用，无法发现“引用了模块作用域”这类问题。仓库现有做法是：拿到 Controller 生成的完整表达式，再在 `node:vm` 中执行：

- `renderer-host-routing.test.ts`、`renderer-host-response-ownership.test.ts`：给 `installRendererDraftPrewarmPolicyDirect` 传入一个 evaluator，由它用 `runInNewContext(expression, { document, window, crypto, ... })` 执行，并提供假的 Fiber、registry 和 manager。
- 主进程路径：在 `runInNewContext` 中提供 `process.mainModule.require` 返回的假 `webContents.fromId`（`renderer-host-routing.test.ts`）。
- `renderer-control-session.test.ts` 用 `runInThisContext` 执行 `inspectElectronWebContents` 生成的主进程表达式。

新增或修改被序列化的函数时，至少要有一条 vm 路径的用例。`test/renderer-draft-prewarm-fixture.ts` 的 `installDraftPrewarmPolicyBridge` 直接调用 `createDraftPrewarmPolicyBridge`，只用于传输层用例，注释写明 “Production installs policies through the native Host router, not this fixture's global slot”，不能拿它证明注入路径可用。

## Desktop 版本回归

Desktop 内部结构变化要用具名用例锁定，例如 “unwraps a Desktop 26.908 host/manager/status Fiber hook wrapper”，以及 “returns null for a Host manager registry and an unrelated nested manager”。每个识别规则都要同时覆盖命中和 fail closed 两个方向。

## 平台 lane

`controller-attachment-server.test.ts` 使用真实 `node:net` 和空闲端口，`production-controller.test.ts` 导入了 `node:path`。它们会被 `tests/vitest.config.js` 归入 Windows platform lane。路径断言不要写死分隔符。

## 包外相关测试

- `tests/release/production-renderer.test.mjs`：检查 Controller 的 `enabledAgents` 与 `KNOWN_RENDERER_AGENTS` 一致。
- `tests/e2e/renderer-adapter-lifecycle.spec.ts`：用 esbuild 把 `packages/desktop-control/src/renderer-draft-prewarm-policy.ts` 和 renderer-extension 打在一起，在 Playwright 浏览器里跑 Host 路由。修改草稿策略或路由的全局契约时要跑这一项。

## 命令

```bash
npx vitest run --config tests/vitest.config.js packages/desktop-control/test/<file>.test.ts
npx vitest run --config tests/vitest.config.js tests/release/production-renderer.test.mjs
npx playwright test --config tests/e2e/playwright.config.js tests/e2e/renderer-adapter-lifecycle.spec.ts
node packages/desktop-control/scripts/build-release.mjs --output <scratch>/desktop-controller.mjs  # 运行 bundle 输入审计
```

以下命令需要真实 Desktop，不属于常规验证：`npm run probe:renderer-binding`、`npm run audit:codex-desktop`（均走 Inspector 路径），以及 `docs/operations/codex-desktop-upgrade-diagnosis-playbook.md`（Inspector 端口是动态分配的，不要写死）。
