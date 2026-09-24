# Adapter 测试组织

通用 vitest 规则（位置、`../src/x.js` 导入、platform lane）见 `.atw/spec/guides/typescript-workspace.md`。本文只写 Adapter 层的做法。

## 分层

| 层 | 文件 | 替身 |
|---|---|---|
| 公共行为（Adapter/Session 契约） | `test/<name>-adapter.test.ts`（最大的测试文件，claude-code 约 5000 行，qoder 约 2500 行） | 实现本包 Transport 接口的 Fake 类，通过构造函数的 `dependencies` 注入 |
| 原生边界（进程、帧、协议解析） | `test/*-transport.test.ts`、`*-rpc-session.test.ts`、`acp-*.test.ts` | 真实子进程跑 fake 脚本，或注入 `processAdapter` / `queryFactory` |
| 纯函数投影 | `*-history.test.ts`、`model-catalog.test.ts`、`slash-commands.test.ts`、`file-change.test.ts` 等 | 原生 JSON 字面量或 fixture 文件 |
| 可执行文件发现 | `command.test.ts` | 注入 `isExecutable`、`platform`、`homeDirectory` |
| 真实 Harness | `*.real.test.ts` | 环境变量控制，默认跳过 |

## Fake Transport（主流）

Adapter 测试不启动真实 CLI。先定义实现 Transport 接口的类，再用 `fixture()` 组装：

- pi：`class FakePiTransport implements PiTurnTransport` + `fixture(options)`（`pi/test/pi-adapter.test.ts`）
- grok：`class FakeGrokTransport implements GrokAcpTransportLike`
- kimi-code：`class FakeTransport implements KimiAcpTransportLike`
- claude-code：`class FakeClaudeTransport implements ClaudeTurnTransport` + `fixture()`
- codebuddy：共享的 `test/fixtures.ts` 导出 `fixture()` 和 `FakeClient`，供多个测试文件复用

因此 Transport 接口要窄，并且要能单独 mock（例如 `PiAdapterDependencies.createTransport`、`ClaudeAdapterDependencies`）。不要让 Adapter 直接 `new` 真实 Transport，否则无法测试。

Qoder 的写法不同：通过 `options.queryFactory` / `forkSession` / `getSessionMessages` 注入。variants 测试用 `vi.mock("@qoder-ai/qoder-agent-sdk", ...)` 替换整个 SDK，验证两个发行版不会混用 SDK。

`@codexhost/harness-adapter/testing` 的 `FakeHarnessAdapter` 是给 Host 测试用的 Harness 替身，Adapter 自己的测试基本不用（只有 `workbuddy/test/plugin-delegation.test.ts` 引用）。

## Fake 可执行文件与 fixture

- **独立 fake 协议脚本**：`cursor-cli/test/fixtures/acp.mjs`、`codebuddy/test/fixtures/acp.mjs`、`copy.mjs`。它们用 `readline` 读 stdin 上的 JSON-RPC，按 `process.argv[2]` 的 scenario（如 `hang-startup`、`hang-auth`）模拟异常。测试里用 `path.resolve("packages/adapters/cursor-cli/test/fixtures/acp.mjs")` 按仓库根解析路径，所以必须在仓库根运行 vitest。
- **临时写入的脚本**：antigravity 测试在 `mkdtemp` 目录里 `writeFile(command, "#!/usr/bin/env node\n…")` 或 `#!/bin/sh`，Windows 分支写 `@echo off`。用 `process.execPath` 作为 command 可以跨平台启动 Node 脚本（claude-code `sdk-transport.test.ts`）。
- **原生历史样本**：`deepseek-harness/test/fixtures/*.jsonl` 保存真实原生版本的会话记录，用于回归。
- 用到 `node:fs`、`spawn`、`mkdtemp`、`process.platform` 的测试会自动进入 Windows platform lane。路径断言要同时兼容 `\` 和 `/`；只在 POSIX 上成立的用例（如 `/usr/bin/script`）要显式按平台跳过。

## 必须覆盖的行为

参照现有测试名，这些是评审时会检查的边界：

- 拒绝路径不产生副作用：“rejects foreign resume, fork, checkpoint and rollback before SDK calls”（qoder），“rejects a stale Checkpoint before calling Grok Fork”（grok）。
- 不伪造能力：“does not manufacture a Permission Mode capability”（pi），“does not translate execution policy into Pi permission options”（pi）。
- 环境传播：“passes per-Session delegation environment to the … transport”（pi、grok、claude-code），“preserves environment scope across create, resume, fork, and rollback”（opencode）。
- 资源清理：“closes the ephemeral transport when inspection fails”（pi），“deletes a Native Fork whose remapped history is not the requested prefix”（claude-code），“closes all created sessions on adapter.close()”（kimi-code）。
- 取消与故障：“keeps the old Turn locked after the interrupt receipt until its native result”（qoder），“fails the Turn and faults the Session when Abort is rejected”（pi）。
- 缓存：“coalesces concurrent inspection and does not cache failures”（claude-code）。

## 真实 Harness 测试

- 命名为 `*.real.test.ts`，默认跳过，写法有两种：`describe.skipIf(process.env.CODEXHOST_RUN_CLAUDE_ADAPTER_REAL !== "1")`（claude-code），或 `describe.runIf(Boolean(process.env.CODEXHOST_OPENCODE_REAL_COMMAND))`（opencode，需要给出真实命令路径）。
- 真实测试要把原生配置隔离到 `mkdtemp` 目录（opencode 设置了 `OPENCODE_TEST_HOME`、`XDG_*_HOME`、`OPENCODE_DISABLE_PROJECT_CONFIG`），不能读写用户真实的会话和配置。能不调用 Model 就不调用（opencode 用例名 “without invoking a Model”）。
- 插件加载链路（真实 ESM 工厂、Manifest、资源）在 `packages/host-runtime/test/harness-plugin-loader.test.ts`、`installed-harness-plugins.test.ts` 里测，打包产物在 `tests/release/host-bundle.test.mjs` 里测。只改 Adapter 内部逻辑时不需要跑这些。

## 命令

```sh
# 单个 Adapter 的某个文件（先确保依赖包已 build：npm run build:typescript）
npx vitest run --config tests/vitest.config.js packages/adapters/<name>/test/<file>.test.ts
# 整个 Adapter
npx vitest run --config tests/vitest.config.js packages/adapters/<name>/test
# 真实 Claude（需要本机已登录的 claude）
CODEXHOST_RUN_CLAUDE_ADAPTER_REAL=1 npx vitest run --config tests/vitest.config.js packages/adapters/claude-code/test/claude-code-adapter.real.test.ts
```
