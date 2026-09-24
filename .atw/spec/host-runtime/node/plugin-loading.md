# 插件加载与发行 Bundle

设计与限制的完整说明见 `docs/architecture/harness-plugin-runtime.md`。本文只记录修改 host-runtime 时必须遵守的代码约束。

## 只通过公共契约加载已安装插件

- `src/` 不能 import `@codexhost/adapter-*`，`tools/check-boundaries.mjs` 会报 "Host Runtime must load installed plugins"。Host 只依赖 `@codexhost/harness-adapter` 的 `HarnessAdapter` 和 `@codexhost/harness-adapter/plugin` 的 `HarnessPluginContext` / `HarnessPluginModule`。
- 预装哪些插件由 `scripts/release/harness-plugins.json` 的 `plugins` 数组决定，**不在 Host 注册代码里维护**。新增预装 Harness 时改这个清单，不改 host-runtime。
- 源码构建时，`npm run build:typescript` 会在 `tsc -b` 之后执行 `build:plugins`，产物输出到 `packages/host-runtime/dist/plugins/`。`npm start -- --no-build` 依赖这些已有产物。

## 根目录与上下文（`installed-harness-plugins.ts`）

- `installedHarnessPluginOptions(environment, managedRemoteHost, hostRuntimeUrl)` 返回两个根目录：
  1. 实际运行的 Runtime 文件旁的 `plugins/`，由 `hostRuntimeUrl` 推导；
  2. `CODEXHOST_PLUGIN_DIRECTORY`，未设置时用 `${CODEXHOST_DATA_DIR 或 ~/.codexhost}/plugins`。
- 注释写明 "never search a project cwd"。不要加入基于 cwd 或项目目录的查找。
- `release-main.ts` 必须把 `import.meta.url` 作为 `hostRuntimeUrl` 传下去，否则 Bundle 找不到相邻的 `plugins/`。
- 受管远程 Host（`managedRemoteHost=true`）不提供 `openLocalUrl`。

## 加载器行为（`harness-plugin-loader.ts`）

- 先扫描所有 Manifest，再 import 模块（注释："so duplicate IDs never win a race"）。同一 ID 在多个根目录出现，或与 `reservedIds`（显式注入的测试 Adapter）冲突时，所有候选都拒绝。
- 根目录必须是绝对路径，而且要有 `enabled.json` 显式启用。缺少 `enabled.json` 的根目录不加载任何插件，也不回退到硬编码实现。
- 最多 4 个 worker 并发；每个插件的 import + 工厂调用单独计 `loadTimeoutMs`（默认 10 秒）。超时后才返回的 Adapter 会被关闭。
- 诊断只包含 `HarnessPluginDiagnosticCode` 和公开 ID，**不透传插件抛出的异常文本、路径或环境变量**。新增失败场景时扩展这个 code 联合类型，不要把 `error.message` 拼进去。
- 资源路径统一经过 `plugin-files.ts` 的 `pluginResourcePath` 校验，拒绝绝对路径和逃出根目录的符号链接。

## 在 `AppServerHost` 中的时序

- `run()` 先初始化官方 app-server，再 `void this.#waitForPlugins()` 在后台一次性加载全部插件（注释："do not hold up Desktop initialization"）。
- 所有涉及外部 Harness 的入口（`thread/start` 的外部分支、inspect、账号、命令目录、会话导入、委派 API）先 `await this.#waitForPlugins()`。新增这类入口时要照做，不要按单个 Harness 按需加载。
- Desktop 输入 EOF 时顺序是：先 `#pluginLoadAbort.abort()`，再 `drain` 请求队列，最后关闭 Session。加载被取消后才返回的 registry 要立即 `close()`。
- 插件未加载或不可用时，外部路由返回错误（`thread/start` 返回 `-32070`），**不回落到官方 Codex**。

## 仍残留的 Harness 名称分支（技术债，不要扩大）

- `external-thread-runtime.ts` 的恢复路径：Grok 在 `open({kind:"resume"})` 时传入 permissionModeId；OpenCode 跳过 `permissionMode.select` 重放；OMP/OpenCode 恢复后把实际配置重新编码并写回 `transportModelId`。这些分支保护的是真实行为，断言在 `test/external-thread-runtime.test.ts`，不能直接删除，也不要照这个样子新增。迁移方向是把"怎么恢复"交给插件（`docs/architecture/harness-plugin-architecture.md` §2.3）。
- `app-server-host.ts` 的 `approvalServerName` switch，以及 `main.ts` 中 Broker 默认的 `"claude-code"`。
- `protocol-core/model-routing.ts` 保留了 7 种旧的专用 Transport Model 编码。新 Harness 使用 `shared-contracts` 的 `encodeHarnessPluginRoute`，前缀为 `codexhost/plugin-v1@`。

## 发行 Bundle 审计（`scripts/build-release.mjs`）

- esbuild 入口固定为 `src/release-main.ts`，目标为 `node22` ESM，并注入 `createRequire` banner。
- `auditHostBundleMetafile` 做三项检查：
  - `forbiddenInputFragments` 拒绝 `packages/adapters/`、`@anthropic-ai/`、`@agentclientprotocol/`、`@deepseek-ai/`、`@opencode-ai/`、`test/`、`tools/` 等输入；
  - 列出必须存在的输入：`app-server-host.ts`、`harness-plugin-loader.ts`、`remote-*.ts`、`harness-broker`、`ws`；
  - 第三方运行时包只允许 `diff`、`ws`、`zod`。
- 新增第三方依赖会让发行构建失败。确实需要时，要同时修改 `allowedRuntimePackages`，并在 PR 中说明理由。
- `auditHostBundleSource` 禁止 `sourceMappingURL=`，也禁止已删除的 `--codexhost-compatibility-update` 命令重新出现。
- 回归测试：`npx vitest run --config tests/vitest.config.js tests/release/host-bundle.test.mjs`。
