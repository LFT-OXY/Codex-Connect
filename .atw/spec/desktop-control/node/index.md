# desktop-control（node）

`@codexhost/desktop-control` 通过 CDP（Renderer 页面的 `--remote-debugging-port`）或 Electron 主进程 Inspector 驱动 Codex Desktop：把 renderer-extension 的 Bundle 注入主窗口，并安装草稿路由策略（draft prewarm policy / Host routing）；它还是生产 Desktop Controller 进程（`release-main.ts`），供 Rust launcher 启动和唤醒。它不拥有 Host 协议与 Harness 语义（`codexhost/*` 请求只转发，不解释），也不做原生进程管理（那归 `crates/launcher`）。

## 依赖与使用方

- 依赖：只依赖 `@codexhost/shared-contracts`（`package.json#dependencies`、`tsconfig.json#references`，仅用于 `WORKSPACE_CONTRACT_VERSION`）。
- 导出：`.`（Node 侧 API，见 `src/index.ts`）和 `./renderer-bindings`（浏览器安全子集，被 `packages/renderer-extension` 的 `versioned-renderer-adapter.ts`、`renderer-codex-usage-gate.ts` 导入）。
- 生产使用方：`scripts/release/prepare-payload.mjs`、`prepare-npm.mjs` 调用 `scripts/build-release.mjs` 打成 `app/desktop-controller.mjs`；源码启动时 `tools/dev-desktop/run.mjs` 直接用 `dist/release-main.js`；`crates/launcher` 传入 `--renderer-cdp-endpoint` 等参数并解析 readiness。
- 开发工具使用方：`tools/renderer-binding/run.mjs`、`tools/codex-desktop-contract-audit/run.mjs` 从 `dist/index.js` 导入 Inspector 路径的 API。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [runtime-sides.md](./runtime-sides.md) | 新增或修改任何 `src/*.ts` 前：先确认代码运行在 Node、Electron 主进程还是 Renderer 页面，以及被序列化注入的函数必须遵守的规则 |
| [control-session-lifecycle.md](./control-session-lifecycle.md) | 修改 CDP 客户端、两条 Control Session、生产 Controller、附件（attachment）协议、readiness、恢复与重试逻辑时 |
| [testing.md](./testing.md) | 写或修改测试、验证注入代码、跑 release bundle 审计时 |

## 改动前检查清单

1. 先判定改动所在的运行侧（[runtime-sides.md](./runtime-sides.md)）。注入 Renderer 的函数必须自包含，不能引用模块作用域的 import 或 helper。
2. 改 `production-controller.ts` 的 `enabledAgents` 时，同步 `packages/renderer-extension/src/agent-selection-state.ts` 的 `KNOWN_RENDERER_AGENTS`，否则 `tests/release/production-renderer.test.mjs` 会失败。
3. 改 readiness 结构（`schemaVersion: 2`）或附件协议（`ATTACH <nonce>` → `ready|busy|rejected|failed`）时，同步修改 `crates/launcher/src/compatibility.rs` 和 `desktop_attachment.rs`。
4. 新增或修改 `__codexhost*V1` 全局或 `codexhost:*` 事件时，搜索 `packages/renderer-extension/src` 的读取方，例如 `versioned-renderer-adapter.ts`、`contract-audit.ts`。
5. 往 `./renderer-bindings` 加导出之前，确认被导出的文件及其依赖都不含 Node API。renderer-extension 会以 `platform: "browser"` 把它打进 Bundle。
6. release bundle 的输入受 `scripts/build-release.mjs` 的 `auditDesktopControllerMetafile` 约束：禁止 Claude Code Adapter、`@anthropic-ai/*`、`test/`、`tools/`，并要求 6 个必需源文件。重命名或删除这些文件时同步修改审计列表。
7. 定向运行本包测试（见 [testing.md](./testing.md)），再运行 `npm run typecheck`、`npm run lint`。
