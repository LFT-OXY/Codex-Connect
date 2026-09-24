# harness-adapter（node）

`@codexhost/harness-adapter` 定义 Adapter 与 Host 之间的**公共进程内契约**：`HarnessAdapter` / `HarnessSession` 接口、Host Event/Item/Interaction 类型、插件工厂契约，以及所有 Adapter 共用的小工具（输出通道、Interaction 校验、Usage 校验、诊断脱敏、live 命令目录）。它不含任何具体 Harness 的逻辑。

## 依赖与入口

- 运行时只依赖 `@codexhost/shared-contracts`（`package.json`、`tsconfig.json#references`）。
- 三个 exports：
  - `.` → `src/index.ts`：类型和工具函数。
  - `./plugin` → `src/plugin.ts`：`HarnessPluginContext`、`HarnessPluginModule`，供各 Adapter 的 `src/plugin.ts` 和 host-runtime 的插件加载器使用。
  - `./testing` → `src/testing.ts`：`FakeHarnessAdapter` / `FakeHarnessSession`。
- 下游：全部 15 个 `packages/adapters/*`、`host-runtime`、`protocol-core`（投影 `HostFileChange`、`HostUsage`、Interaction）、`harness-broker`（跨进程转发同一套契约）。
- `scripts/build-plugin.mjs` 不在包导出里，由 `scripts/release/harness-plugins.mjs` 和 `tools/build-cursor-plugin.mjs` 通过相对路径导入，把单个插件打成可重定位的 `plugin.mjs`。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [session-contract.md](./session-contract.md) | 修改 `text-session.ts`、`plugin.ts` 中任何类型，或新增可选能力、事件、命令、错误码时 |
| [testing.md](./testing.md) | 修改 `testing.ts` 的 Fake，或在其他包里写需要模拟 Harness 的测试时 |

源码：`text-session.ts`（583 行，全部是类型）、`plugin.ts`、`output-channel.ts`、`interaction.ts` / `approval.ts` / `question.ts`、`usage.ts`、`diagnostics.ts`、`live-command-catalog.ts`、`credential-imports.ts`、`testing.ts`（1287 行）。

## 改动前检查清单

1. 契约是**类型**而不是 zod schema：插件在 Host 进程内加载，TS 类型就是契约。唯一需要运行时校验的输入（Usage、Interaction 响应）用手写校验函数（`parseHostUsage`、`validateHostInteractionResponse`），不要为此引入 zod。
2. 新增 Adapter/Session 成员时一律做成**可选**（`inspectAccount?`、`sessionImport?`、`webUi?`、`commands?`），因为插件按 `adapterApiVersion` 精确匹配加载，旧插件缺少新成员也必须仍然有效（`docs/architecture/harness-plugin-runtime.md`："该可选扩展兼容未实现能力的插件"）。
3. 修改契约前先列出实现者：`grep -rn "implements HarnessAdapter\|implements HarnessSession" packages`，当前约 30 处，另有 `BrokeredHarnessAdapter`、host-runtime 的 `ReadonlySnapshotSession` 和测试里的对象字面量实现。
4. 修改 `HostEvent` / `HostCommand` / `HarnessErrorCode` 时同步更新 `harness-broker/src/validation.ts`（`eventKeys`、`brokerHostCommandSchema`、`harnessErrorSchema`），否则经 Broker 转发的会话会把新形态当作协议错误拒绝。
5. 修改 `HostItem` 种类时同步 `protocol-core/src/codex-ui-projector.ts` 和 `host-runtime` 的投影；只加类型、不加投影，Desktop 上就看不到该 Item。
6. `sanitizeDiagnosticTail` 的上限是 8000 字符，只保留**尾部**。它负责脱敏 `Bearer`、`api_key=`/`token:`/`password=` 这类值；新增的敏感模式加在这里，不要在各 Adapter 里各写一份。
7. 定向验证：`npx vitest run --config tests/vitest.config.js packages/harness-adapter/test/`；契约有变动时，还要执行 `npm run typecheck`，编译全部 Adapter 和 host-runtime。
