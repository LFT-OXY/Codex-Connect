# 测试分工

本包有四层验证，各自证明的东西不同，不能互相替代。

| 层 | 位置 | 运行 | 证明什么 | CI |
|---|---|---|---|---|
| vitest 单元测试 | `packages/renderer-extension/test/**/*.test.ts` | `npx vitest run --config tests/vitest.config.js packages/renderer-extension/test/<file>.test.ts` | 纯逻辑、状态机、schema 往返，以及基于伪 DOM 的挂载和清理 | `npm run test:typescript` 跑 |
| 发布链静态断言 | `tests/release/production-renderer.test.mjs` | `npx vitest run --config tests/vitest.config.js tests/release/production-renderer.test.mjs` | 生产入口形态，以及 Renderer 与 Controller 的 Agent 名单一致 | 跑 |
| Playwright e2e | `tests/e2e/*.spec.ts` | `npx playwright test --config tests/e2e/playwright.config.js tests/e2e/<file>.spec.ts` | 真实 Chromium 中的布局、Shadow DOM 样式、交互、多 Host 生命周期 | **不跑**（`ci.yml` 只有 format、lint、typecheck、test:typescript） |
| 真实 Desktop | `npm run probe:renderer-binding`、`npm run audit:codex-desktop`、`npm start` | 需要本机 Codex Desktop | 原生 DOM/React 契约与真实路由 | 不跑 |

## vitest：Node 环境，没有 jsdom

`tests/vitest.config.js` 的 `environment` 是 `"node"`，仓库里没有 jsdom 或 happy-dom，也不编译 CSS。能直接测的只有纯函数；涉及 DOM 的代码有三种现成写法，按优先顺序选：

1. **注入 DOM 端口**：模块接收一个小接口，测试里提供 Fake 实现。例如 `renderer-sidebar-agent-icons.ts` 的 `SidebarAgentIconDom` / `SidebarAgentIconRow`（测试中的 `FakeDom`、`FakeRow`），`renderer-fork-control.ts` 的 `RendererForkDom`（`FakeForkDom`）。新写的 DOM 模块优先采用这种设计。
2. **拆出视图函数**：把“计算要渲染什么”和“写 DOM”分开，只测前者，例如 `rendererAgentPickerView`、`rendererAgentMenuPlacement`、`createDefaultRendererSettingsPages`。
3. **手工桩全局对象**：`vi.stubGlobal("document" | "window" | "MutationObserver", …)`，配合 `as unknown as HTMLElement` 构造最小对象；`afterEach` 中必须调用 `vi.unstubAllGlobals()`（见 `renderer-fork-control.test.ts`、`settings/trigger.test.ts`）。

- 测试导入本包源码时用 `../src/x.js`，导入 `@codexhost/shared-contracts` / `@codexhost/desktop-control` 则解析到 `dist`，需要先执行 `npm run build:typescript`。
- ID 和品牌类型要用 schema 构造（`hostThreadIdSchema.parse("…")`、`harnessIdSchema.parse("…")`），不要用 `as` 硬转。
- 包装 Desktop RequestManager 的改动必须有 RPC 可访问性测试。对普通对象直接调用的测试证明不了 RpcTarget 行为，参照 `renderer-external-steering-rpc.test.ts`（类方法可访问、卸载后恢复原型查找、待定请求清理）。
- 旧 Host 兼容用 `renderer-unsupported-methods.test.ts` 的写法：构造 `-32600 "Invalid request: unknown variant ..."` 错误，断言调用方给出“不可用”而不是“失败”或空数据。
- 视觉效果不在 vitest 里断言，样式交给 e2e 和人工检查（`docs/architecture/renderer-settings-styling.md`）。

## Playwright e2e：真实浏览器 + 真实源码 + 伪 Host

所有 spec 用法一致（参见 `renderer-adapter-lifecycle.spec.ts`、`renderer-settings-accounts.spec.ts`）：

1. 在模块顶层用 esbuild 的 `stdin` 打包 `packages/renderer-extension/src/...ts`，写一个 `globalThis.setupXxx(...)` 夹具。配置保持 `platform: "browser"`、`format: "iife"`、`target: "es2024"`，loader 与 `scripts/build.mjs` 相同，并接入 `tailwindEsbuildPlugin()`。
2. `page.route("https://codexhost.test/**", …)` 返回空白 HTML，`page.goto` 后用 `addScriptTag` 注入 bundle，再通过 `page.evaluate` 调用夹具。
3. Host 客户端和 Desktop Manager 都是夹具里的伪对象，不连接真实账号或 Host。

- `CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH` 可指定浏览器可执行文件。时间相关的 UI 用 `test.use({ timezoneId })` 固定时区。
- e2e spec 由 `tests/tsconfig.json` 纳入 `npm run typecheck`，类型错误会在 CI 中暴露，但行为不会在 CI 中执行。改动设置页样式、Shadow DOM 或多 Host 生命周期后，要在本地运行对应的 spec，并在汇报中写明是否运行过。

## 真实 Desktop 与发布链

- 新增 Agent 或改动生产入口后，运行 `tests/release/production-renderer.test.mjs` 和 `packages/renderer-extension/test/production-controller-agent-contract.test.ts`。
- 改动原生 DOM 依赖后，需要在真实 Desktop 上用 `npm run audit:codex-desktop` 对比基线（见 `tools/codex-desktop-contract-audit/README.md`）。审计只看结构，不验证行为，所以行为仍然需要通过 `npm start` 人工验收。
- 最小的构建验证：`npm run build:renderer`，确认四个入口都能打包，并且没有 Node 依赖被带进 bundle。
