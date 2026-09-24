# shared-contracts（node）

`@codexhost/shared-contracts` 存放跨进程、跨包、跨浏览器边界共享的 zod schema 和由它推导的类型，以及少量纯函数编解码（Harness 路由、delegation mention 载体）。它同时被 Node 包和注入 Codex Desktop 渲染进程的 `renderer-extension` 打包使用，所以**必须保持浏览器安全**。

## 依赖与边界

- 运行时依赖只有 `zod`（`package.json#dependencies` 固定 `"zod": "4.4.3"`），`tsconfig.json` 没有 `references`。
- 不能依赖任何 `@codexhost/*` 包，不能导入 Node 内置模块、`electron`、Harness SDK。由 `tools/check-boundaries.mjs` 的 `sharedContractsDirectory` 分支强制（只检查 `src/`，`test/` 可以用 `node:path`、`esbuild`）。
- 下游：`protocol-core`、`host-runtime`、`mapping-store`、`harness-adapter`、`harness-broker`、`desktop-control`、`renderer-extension` 以及全部 `packages/adapters/*`。改 schema 就是改所有这些包的线上契约。
- 公开入口：`.`（`src/index.ts`）和 `./version`（`src/version.ts`，只有 `WORKSPACE_CONTRACT_VERSION = 1`）。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [schema-conventions.md](./schema-conventions.md) | 新增或修改任何 schema、品牌 ID、RPC method 常量、可选字段时 |

源码按契约主题一文件一主题：`ids.ts`、`native-refs.ts`、`json-value.ts`、`json-rpc.ts`、`errors.ts`、`harness-plugins.ts`、`harness-route.ts`、`harness-models.ts`、`harness-permission-modes.ts`、`harness-commands.ts`、`harness-accounts.ts`、`codex-accounts.ts`、`thread-usage.ts`、`harness-session-import.ts`、`updates.ts`、`idle-release.ts`、`loaded-sessions.ts`、`credential-imports.ts`、`harness-launch-settings.ts`、`external-thread-fork.ts`、`delegation-mention.ts`、`reasoning-transcript.ts`。

## 已知的历史/特例（照实记录，不要扩散）

- `deepseek-modern-sessions.ts` 是 Harness 专属契约，现在只是 `harness-session-import.ts` 的别名层（常量和 candidate schema 直接复用）。Host 仍用它服务旧的 `codexhost/deepseek/modern-session/*` 兼容 RPC（见 `docs/architecture/harness-session-import.md`）。新的导入能力走通用的 `harnessSession*` schema，不要再加 `<harness>-*.ts` 专属契约。
- `reasoning-transcript.ts` 的 `REASONING_TRANSCRIPT_COMMAND = "thinking"` 标注为 `PROTOTYPE`：Reasoning 被投影成携带该哨兵命令的 Command Execution，Host 投影和 Renderer 摘要都依赖这个字符串。
- `src/index.ts` 大多数模块用显式具名导出，但 `credential-imports.js`、`harness-launch-settings.js` 用了 `export *`。新增模块沿用显式具名导出，便于看清公共面。
- `json-value.ts` 的 `rejectExplicitUndefined` 没有从包根导出，只在包内 schema 使用。

## 改动前检查清单

1. 只允许 `import { z } from "zod"` 和包内相对导入；不要用 `Buffer`、`node:*`，编码类逻辑用纯 JS（参照 `harness-route.ts` 的十六进制编码注释 "no Node.js Buffer dependency"）。
2. 新导出要同时加到 `src/index.ts`，并确认没有和已有名字冲突；如果它会被浏览器使用，把它加进 `test/browser-bundle.test.ts` 的 stdin 导入列表。
3. 新增或放宽字段前，`grep` 所有下游的 `.parse(` / `.safeParse(` 调用点：schema 是 strict 的，Host 先放宽而 Renderer 未更新（或反之）会直接拒绝报文。
4. 不要把 Native 细节（原生配置、凭据、文件路径、wire payload）塞进浏览器契约；现有测试专门断言这些字段被拒绝（`credential-imports.test.ts`、`harness-session-import.test.ts`、`codex-accounts.test.ts`）。
5. 不要为 `CodexhostError.code` 引入全局枚举（`errors.test.ts`："accepts the minimal shared structure without fixing a global code enum"），由拥有方包自行收窄。
6. 修改后先 `npm run build:typescript`（其他包的测试解析的是 `dist`），再跑定向测试：
   `npx vitest run --config tests/vitest.config.js packages/shared-contracts/test/<file>.test.ts`，以及受影响下游包的对应测试。
7. 本包测试在 CI 中只在 Linux x64 执行（`docs/operations/repository-maintenance.md`），本地要自己跑 `browser-bundle.test.ts` 确认浏览器可打包。
