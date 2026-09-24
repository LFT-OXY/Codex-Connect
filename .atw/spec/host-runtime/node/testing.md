# 测试组织

基础约定见 `guides/typescript-workspace.md` 的"测试"一节。以下是本包特有的内容。

## `app-server-host.*.test.ts` 的拆分方式

- `app-server-host.test.ts` 原来有约 7500 行，全部压在一个 vitest worker 上串行执行。commit `cf017fcd`（"ci: stabilize and speed up the Windows test lane"）把它拆成了多个文件：`app-server-host.test.ts`（空闲释放、官方转发、已安装插件）、`app-server-host.projection-1..4.test.ts`、`.thread-commands.test.ts`、`.command-steering.test.ts`，共用 `test/app-server-host-fixture.ts`。
- `projection-1..4` 使用同一个 describe 名 "AppServerHost HarnessAdapter projection"。它们是**为了并行而切分的**，不是按主题分组，每个文件 1500–2100 行。新的投影用例放进行数较少的那个文件，不要再建 `projection-5`；只有当现有文件接近 2000 行以上时才新增。
- 某个主题可以独立成组时（比如命令、steering），用 `app-server-host.<主题>.test.ts` 命名。
- `app-server-host-fixture.ts` 提供以下工具，新用例优先复用，不要在测试文件里重新定义：
  - `createFixture(options)`：内置 `FakeOfficialProcess`、`JsonLineCollector`、临时 `MappingStore`，并设置 `officialCloseTimeoutMs: 50`；
  - `startExternalThread` / `startPiThread` / `startPiTurn` / `completePiTurn`、`closeFixture` / `stopFixture`；
  - `readJsonLine`、`writeRequest`、`method` / `requestId` / `turnEvent` 等消息谓词；
  - 故障注入用的 `FailingArchiveMappingStore` 等 `MappingStore` 子类；
  - 带特定能力的 `FakeHarnessAdapter` 子类，例如 `rollbackCapableAdapter`、`WebUiHarnessAdapter`、`ModernSessionImportAdapter`。
- 持久化失败的另一种注入方式：给 `new MappingStore({ directory, beforeReplace(record) { throw … } })` 传入 `beforeReplace`（例如 `projection-3/4`、`deepseek-modern-session-import.test.ts`）。这个选项只供测试使用，生产代码从不传入。

## 真实 Harness 用例（`*.real.test.ts`）

| 文件 | 开关 |
|---|---|
| `app-server-host.claude.real.test.ts` | `CODEXHOST_RUN_CLAUDE_HOST_REAL=1`（同一文件内还有一个始终运行的 hermetic describe） |
| `antigravity-question.real.test.ts` | `CODEXHOST_RUN_ANTIGRAVITY_QUESTION_REAL=1`，证据输出到 `CODEXHOST_ANTIGRAVITY_QUESTION_EVIDENCE_DIR` |
| `antigravity-subagents.real.test.ts` | `CODEXHOST_RUN_ANTIGRAVITY_SUBAGENTS_REAL=1`，同样支持 `…_EVIDENCE_DIR` |
| `hermes-plugin-loader.real.test.ts` | `CODEXHOST_RUN_HERMES_LIVE=1`，使用临时插件根目录，不会碰 `~/.codexhost` |

- 统一写法是 `describe.skipIf(!RUN_REAL)`，默认跳过。所以这些用例通过**不代表**真实 Harness 已验收。
- 测试目录允许 import 具体 Adapter（例如 `@codexhost/adapter-claude-code`），因为 `check-boundaries` 只检查 `src/`。**生产代码仍然禁止。**

## 依赖构建产物的用例

- `harness-plugin-loader.test.ts`、`installed-harness-plugins.test.ts`、`hermes-plugin-loader.real.test.ts` 会读取 `packages/host-runtime/dist/plugins/` 或按包名导入 Adapter。运行前必须先执行 `npm run build:typescript`（其中包含 `build:plugins`），否则会报找不到文件。
- `test/index.test.ts` 锁定 `packageMetadata.dependencies` 的数量，并禁止出现 `adapter-*`。

## 平台与时间

- 本包几乎所有测试都会用到 `node:fs`、进程或 `MappingStore`，因此都会进入 Windows 的 platform lane。Windows 上 vitest 的超时时间已经调大到 20s/30s（见 `tests/vitest.config.js` 的注释）。**不要为了规避 Windows 的慢速磁盘而在单个用例里写死更短的 sleep。**
- 涉及超时的逻辑用 `vi.useFakeTimers()`，已有例子：`external-turn-steering`、`external-thread-idle-release`、`official-runtime-owner`、`official-process-lifecycle`。
- 模块级依赖通过 `setXxxDependenciesForTest` 注入并在结束时恢复（`remote-host-lifecycle.ts` 的 `setRemoteHostLifecycleDependenciesForTest`）。只在确实无法构造注入时使用这种方式。

## 定向运行

```bash
npx vitest run --config tests/vitest.config.js packages/host-runtime/test/external-thread-runtime.test.ts
npx vitest run --config tests/vitest.config.js packages/host-runtime/test/app-server-host.projection-2.test.ts
CODEXHOST_RUN_CLAUDE_HOST_REAL=1 npx vitest run --config tests/vitest.config.js packages/host-runtime/test/app-server-host.claude.real.test.ts
```

修改 `app-server-host.ts` 的分派逻辑后，至少运行 `app-server-host.test.ts`，以及和改动相关的那个 `projection-N`。不要默认跑整个包。
