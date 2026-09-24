# renderer-extension（browser）

`@codexhost/renderer-extension` 是注入 Codex Desktop 渲染进程的浏览器 JS：在官方 Composer、Sidebar、Transcript 与应用头部接入 Agent 选择、Model/Thinking/Permission Mode 控件、用量与额度、Fork、调整方向，以及 Shadow DOM 设置页。它只通过 Desktop 已有的 RequestManager 向 Host 发 `codexhost/*` JSON-RPC，不拥有 Host 协议或 Harness 语义。

## 边界与依赖

- `package.json#dependencies`：`@codexhost/shared-contracts`（全部 schema、ID 品牌类型、路由 codec）、`@codexhost/desktop-control`（**只允许** `./renderer-bindings` 子路径）、`lucide`。
- `src/` 只能用 `@codexhost/desktop-control/renderer-bindings`（`committedReactAncestors`、`RendererHostRoute` 类型）。根入口 `@codexhost/desktop-control` 是 Node 侧 CDP 代码；`tools/check-boundaries.mjs` 只查导入说明符，不会拦住这个根入口导入，但 esbuild 的 `platform: "browser"` 打包会失败，或把 Node 代码带进 bundle。测试（Node 环境）可以导入根入口，见 `test/production-controller-agent-contract.test.ts`。
- `check-boundaries` 对本包禁止：Node 内置模块、`electron`、`@anthropic-ai/claude-agent-sdk`、`@openai/codex-sdk`、`@agentclientprotocol/sdk`、pi 系列 SDK。
- `tsconfig.json` 与其他包不同：`module: ESNext` + `moduleResolution: Bundler`，`lib` 含 `DOM`，`emitDeclarationOnly`（类型输出到 `dist/types`，JS 由 esbuild 产出）。
- 下游：`tools/dev-desktop/run.mjs` 与 `scripts/release/prepare-payload.mjs` 使用 `dist/production.js`（发布时改名为 `app/renderer-extension.js`）；`tools/renderer-binding/run.mjs` 使用 `dist/renderer-binding-probe.js`；`tools/codex-desktop-contract-audit/run.mjs` 使用 `dist/contract-audit.js`。

## 构建产物（`scripts/build.mjs`）

| 入口 | 格式 | 输出 | 用途 |
|---|---|---|---|
| `src/index.ts` | esm | `dist/index.js` | 包公开 API（供测试与工具使用） |
| `src/production-entry.ts` | iife | `dist/production.js` | 生产注入；读取并删除 `window.__codexhostProductionConfigV1` |
| `src/probe-entry.ts` | iife | `dist/renderer-binding-probe.js` | 开发探针，启用全部 Agent |
| `src/audit-entry.ts` | iife | `dist/contract-audit.js` | 只读契约审计，挂到 `window.__codexhostContractAuditV1` |

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [dom-integration.md](./dom-integration.md) | 改 Composer/Sidebar/Transcript/设置入口的 DOM 接入、React fiber 读取、新增 Agent、Transport Model carrier、契约审计 |
| [host-rpc.md](./host-rpc.md) | 新增或修改 `codexhost/*` 方法、通知订阅、多 Host 路由、RequestManager 包装 |
| [styling.md](./styling.md) | 改设置页或注入控件的样式、Tailwind、图标与品牌资源 |
| [testing.md](./testing.md) | 选择 vitest 伪 DOM 测试、Playwright e2e 或真实 Desktop 探针 |

## 改动前检查清单

1. 新增导入前确认没有 Node 内置模块或 SDK，desktop-control 只走 `/renderer-bindings`；改完运行 `npm run lint` 和 `npm run build:renderer`，确认 esbuild 能打出 browser bundle。
2. 新增 Agent 时，同步 `agent-selection-state.ts#KNOWN_RENDERER_AGENTS`、`desktop-control/src/production-controller.ts` 的 `enabledAgents` 和 `tools/renderer-binding/run.mjs#RENDERER_PROBE_AGENTS`。`tests/release/production-renderer.test.mjs` 会断言前两者一致。详见 dom-integration.md。
3. 新的 Harness 路由一律用 `encodeHarnessPluginRoute`，不要再加私有 `codexhost/<x>-native@` 前缀。
4. 改动 `RendererContractAuditInspection` 或 `RendererBindingProbeStatus` 的结构时，同步 `desktop-control/src/contract-audit.ts` 和 `renderer-control-session.ts` 里手写的同构类型与校验。
5. 定位原生 DOM 时使用 `data-*` / ARIA / `role`，不要用 Codex 生成的 class 名；新增 DOM 依赖要配一个 `inspect…Contract` 并接入 `contract-audit.ts`。
6. `renderer-binding-probe.ts`（约 3000 行，`installRendererBindingProbe` 是一个巨型闭包）、`versioned-renderer-adapter.ts`（约 1100 行）和 `settings/connections-page.ts`（约 1060 行）都已超出规模阈值，新职责放进独立模块，再由它们接线调用。
7. 新的 UI 文案同时补齐 `en` 与 `zh-CN` 两份：设置页写在 `settings/localization.ts`（`RendererSettingsMessages`，完整性由 `test/settings/localization.test.ts` 校验），Composer 控件写在 `renderer-harness-localization.ts`。不要在组件里硬编码单语字符串。
