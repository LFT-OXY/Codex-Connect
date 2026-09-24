# adapter-hermes（Node）

> 通用约定见 `.atw/spec/adapters/node/index.md`（plugin.ts 工厂、manifest、HarnessResult、command.ts、测试组织等）。本目录只写 Hermes 特有内容。

`@codexhost/adapter-hermes` 用两条原生传输把 NousResearch Hermes Agent 接入为 Harness：

- **gateway**：Hermes 官方 `tui_gateway` JSON-RPC over stdio，由 Hermes 安装自带的 Python 以 `-I -u -c` 启动。新会话优先走这条。
- **ACP**：`hermes acp`，经 `@agentclientprotocol/sdk` 连接。用于没有 gateway locator 的旧 Native Ref，以及本机没有可用 gateway 时的新会话。

两条协议不会在同一个会话上混用。公共 Adapter、Host Runtime、Renderer 都不含 Hermes 专用逻辑（`docs/harnesses/hermes/hermes-capabilities.md`）。

- 依赖（`package.json`）：`@agentclientprotocol/sdk@1.3.0`、`@codexhost/harness-adapter`、`@codexhost/harness-discovery`、`@codexhost/shared-contracts`、`diff@8.0.2`。本包版本为 `0.1.0`（其他 Adapter 是 `0.0.0`），`manifest.json` 没有 `icon` 字段，只有 `links.documentation`。
- 可执行文件：`CODEXHOST_HERMES_COMMAND`（`plugin.ts` 与 `command.ts` 的 `hermesDiscoverySpec`），找不到时抛 `HermesExecutableError`（`code = "HERMES_NOT_FOUND"`）。gateway 所用的 Python 可以用 `CODEXHOST_HERMES_GATEWAY_PYTHON` 显式指定。
- `src/index.ts` 除 `HermesAdapter` 外还导出 `HermesAcpTransport`、`resolveHermesExecutable` 等内部类型。它们只供本包测试和调试使用，其他包不要依赖。

## 与 host-runtime 中 Hermes 测试的关系

`packages/host-runtime/test/hermes-plugin-loader.real.test.ts` 不测试 Hermes 协议，它验证的是 Host 的通用插件加载器：把构建产物 `packages/host-runtime/dist/plugins/hermes`（由 `npm run build:plugins` 按 `scripts/release/harness-plugins.json` 生成）复制到临时插件根，经 `loadHarnessPlugins` 加载，再对真实 Hermes 调用一次 `inspect()`。该测试只在 `CODEXHOST_RUN_HERMES_LIVE=1` 时运行。`installed-harness-plugins.test.ts` 和 `harness-plugin-loader.test.ts` 也只把 hermes 当作预装插件列表中的一项，断言其命令菜单（`/help /tools /context /version /compress`）和 `CODEXHOST_HERMES_COMMAND`。

**代码与该测试的冲突**：它的注释写的是 “real `hermes acp` child process”，断言的 permission modes 是 ACP 的 `["default","accept_edits","dont_ask"]`。但当前 `HermesAdapter.inspect()` 在探测到可用 gateway 时，返回的是 `gatewayPermissionModes()` 的 `["default","dont_ask"]`。所以在装有新版 Hermes 的机器上，这条 live 断言会失败。改 inspection 或权限目录时，需要同步修正该测试，或把它限定为 ACP 场景。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [transports-and-session.md](transports-and-session.md) | 改路由、gateway/ACP 传输、Session 外观、交互、Model/Thinking/Permission、命令与压缩、Edit Diff、跨 Harness 委派时 |
| [gateway-history.md](gateway-history.md) | 改 gateway 历史读取、精确 Fork、修订上一条、派生清理时 |
| `docs/harnesses/hermes/hermes-capabilities.md` | 原生依据（hermes-agent 提交号）、验证范围和各能力边界的权威说明 |

## 源码地图（`packages/adapters/hermes/src`）

| 文件 | 职责 |
|---|---|
| `hermes-adapter.ts` | `HermesAdapter`：inspect、gateway/ACP 路由、会话 owner 排他、ACP 热进程、会话导入 |
| `hermes-session.ts`（约 1250 行） | `HermesSession`：两条传输共用的 `HarnessSession` 外观（Turn、审批、Question、配置、Usage、历史 Turn） |
| `acp-transport.ts` | `HermesAcpTransport` 与两条传输共享的 `HermesSessionTransport` 接口 |
| `gateway-transport.ts` / `gateway-session-transport.ts` / `gateway-open.ts` | gateway 进程与 JSON-RPC；把 gateway 事件适配成 `HermesSessionTransport`；打开、恢复、派生的编排 |
| `gateway-history.ts` / `gateway-history-script.ts` | 通过独立 Python 进程读写官方 SessionDB（读取、解析身份、派生、清理） |
| `gateway-delegation.ts` / `gateway-configuration.ts` | 进程内注册私有委派 Skill；gateway Model 选择 |
| `hermes-inventory.ts` / `hermes-models.ts` | Python 一次性探测模型目录；Model Ref 与 ACP 权限目录 |
| `hermes-questions.ts` / `hermes-file-changes.ts` / `hermes-compaction.ts` / `hermes-commands.ts` / `hermes-import.ts` | Question 生命周期；ACP diff → fileChange；压缩结果判定；命令目录；ACP `session/list` 导入 |

## 改动前检查清单

1. 路由规则不能松动：有 gateway locator 的 Ref 只走 gateway，gateway 不可用时直接失败，**不能**交给 ACP 打开；没有 locator 的 Ref 永远走 ACP，即使本机已安装 gateway。
2. gateway 兼容性只看运行时能力：`gateway.capabilities.per_session_exclusive_submit === true`。不要比较 Hermes 发布版本、contract 或 ACP protocolVersion 的数值。
3. 同一原生 Session 只能有一个 owner：resume 前检查 `#openingNativeIds` 和 `#sessions`，冲突时返回 `sessionBusy`（retryable）。源 Turn 正在运行时，也拒绝从它派生 Fork/回滚。
4. 用户配置不能被修改：Model、Thinking、YOLO 只用会话级接口（`config.set` scope=session）设置，并回读确认；委派 Skill 只在当前进程注册，不写 Hermes 的技能目录。
5. history 子进程的 stderr 不允许外露（`gateway-history.ts` 注释：原生异常可能带有对话或配置内容）；gateway 的 stderr 必须经过 `sanitizeDiagnosticTail`。
6. Model Ref 是原生 id 的 base64url，没有归属前缀（`hermes-models.ts`）；`decodeHermesModelRefId` 只检查字符集，所以还要再和目录比对，不能把解码成功当作“属于 Hermes”的证明。

## 定向验证

```bash
npx vitest run --config tests/vitest.config.js packages/adapters/hermes/test/hermes-adapter.test.ts packages/adapters/hermes/test/gateway-routing.test.ts packages/adapters/hermes/test/gateway-session.test.ts
npx vitest run --config tests/vitest.config.js packages/adapters/hermes/test/gateway-transport.test.ts packages/adapters/hermes/test/hermes-capabilities.test.ts packages/adapters/hermes/test/hermes-inventory.test.ts packages/adapters/hermes/test/hermes-inspection.test.ts
# 已安装 Hermes 的原生集成（隔离 HERMES_HOME、本地模拟模型；未设置时跳过）
CODEXHOST_HERMES_NATIVE_TEST_PYTHON=<hermes venv python> npx vitest run --config tests/vitest.config.js \
  packages/adapters/hermes/test/gateway-history.test.ts packages/adapters/hermes/test/gateway-native.test.ts
# Host 插件加载 live 验收（需先 npm run build:typescript）
CODEXHOST_RUN_HERMES_LIVE=1 npx vitest run --config tests/vitest.config.js packages/host-runtime/test/hermes-plugin-loader.real.test.ts
```
