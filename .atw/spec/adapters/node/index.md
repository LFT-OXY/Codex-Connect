# Harness Adapter 共同约定（packages/adapters/*）

> 本目录是全部 15 个 Adapter 共用的 spec。各 Adapter 自己的 spec（`.atw/spec/adapter-<name>/node/`）只写该 Harness 特有的内容，并引用本文。TypeScript 通用规则见 `.atw/spec/guides/typescript-workspace.md`，这里不重复。

## 职责与边界

每个 `packages/adapters/<name>/` 是一个独立的 Harness 插件：用 Harness 的原生接口（SDK、原生 RPC、ACP、stream-json CLI、本地服务）实现公共契约 `HarnessAdapter` / `HarnessSession`（`packages/harness-adapter/src/text-session.ts`），由 Host 通过 Manifest + 工厂动态加载。

- **向上**只暴露公共契约。Host Runtime 不得静态导入 Adapter（`tools/check-boundaries.mjs` 对 `host-runtime/src` 导入 `@codexhost/adapter-*` 报错），预装集合只写在 `scripts/release/harness-plugins.json`。
- **向下**的原生协议、会话文件格式、Model/权限编码、Fork/Rollback 手段都留在 Adapter 内，不上移到 `harness-adapter`、`protocol-core`、`host-runtime` 或 Renderer。
- 允许的依赖：`@codexhost/harness-adapter`（含 `/plugin`、`/testing`）、`@codexhost/shared-contracts`、`@codexhost/harness-discovery`、原生 SDK。例外只有三处，且都是现状：`claude-code` / `codebuddy` / `cursor-cli` / `workbuddy` 的 `plugin.ts` 依赖 `@codexhost/harness-broker`；`workbuddy` 依赖 `@codexhost/adapter-codebuddy`；`qoder-cn` 依赖 `@codexhost/adapter-qoder`。Adapter 之间的依赖只能走对方包的公开 exports。

## 15 个 Adapter 一览

| 目录 / Harness ID | 原生接入 | 发现文件 | 备注 |
|---|---|---|---|
| `pi` / `pi` | 原生 RPC（`pi --mode rpc`，stdio JSONL） | `command.ts` | 最小参考实现；无 Permission Mode |
| `omp` / `omp` | 原生 RPC（`--mode rpc`） | `command.ts` | 权限切换需重启 Transport |
| `claude-code` / `claude-code` | `@anthropic-ai/claude-agent-sdk`；macOS 受管远程走 Broker | `command.ts` | 见 `adapter-claude-code` |
| `qoder` / `qoder`、`qoder-cn` / `qoder-cn` | `@qoder-ai/qoder-agent-sdk` / `@qodercn-ai/qodercn-agent-sdk` | `qoder-command.ts` | 同一实现两个插件 |
| `opencode` / `opencode` | `opencode serve` 本地服务 + `@opencode-ai/sdk` | `command.ts` | 共享服务、事件流 |
| `deepseek-harness` / `deepseek-harness` | 本地服务 + WebSocket（`ws`），`profiles/` 按原生版本分派 | `executable.ts` | 只剩 `modern/`，无 `legacy/` |
| `antigravity` / `antigravity` | CLI `--output-format stream-json` | `command.ts` | 插件自持历史 |
| `grok`、`kimi-code`、`kiro-cli`、`cursor-cli`、`codebuddy` | ACP（`@agentclientprotocol/sdk` 的 `ClientSideConnection` + `ndJsonStream`） | `command.ts` | Grok 另有私有扩展 |
| `workbuddy` / `workbuddy` | 复用 `adapter-codebuddy` 的 ACP 实现，`--acp` | `command.ts` | 唯一声明 `launchCommand: true` |
| `hermes` / `hermes` | 新会话走 Python `tui_gateway`（stdio JSON 行），旧引用走 ACP | `command.ts` | ACP 路径不支持 Fork/Rollback |

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [plugin-structure.md](./plugin-structure.md) | 新建 Adapter、改 `manifest.json` / `plugin.ts` / `command.ts` / 包依赖 / 预装清单时 |
| [session-contract.md](./session-contract.md) | 实现或修改 `inspect` / `open` / `execute` / `readSnapshot` / `close`、错误映射、能力声明、Fork/Rollback 时 |
| [testing.md](./testing.md) | 为 Adapter 写测试、加 fake 可执行文件、加 `*.real.test.ts` 时 |

## 改动前检查清单

1. 先读目标 Adapter 自己的 spec 和 `docs/harnesses/<name>/`，再读公共契约 `packages/harness-adapter/src/text-session.ts`。签名以源码为准，不以 `.agents/skills/codexhost-add-harness/` 的描述为准（该 skill 仍写“七个 Harness”、Antigravity 不支持 Fork、DeepSeek 有 `legacy/`，均已过时）。
2. 需要的能力原生不支持时，声明为 `false`，对应分支返回 `unsupported`。不要在 Host、Renderer 或公共包里加 Harness 名称分支来绕过（见 `docs/harnesses/capability-boundaries.md`）。
3. 新增依赖要同时改 `package.json#dependencies`、`tsconfig.json#references`；第三方运行时包还要加进 `scripts/release/harness-plugins.json#runtimePackages`，否则 `build-plugin.mjs` 会以 “unreviewed runtime package” 失败。
4. 检查 `open()` 的每个分支是否都用了 `input.environment`，是否都校验了 `nativeRef.harnessId` / `checkpoint.nativeSessionId`，失败路径是否关闭了新建的进程或连接。
5. 不要往已超过 1500 行的主文件（`claude-code-adapter.ts` 约 3000 行，`omp-adapter.ts`、`pi-adapter.ts` 约 2500 行，`deepseek-harness/src/modern/session.ts` 约 3000 行，`grok-adapter.ts`、`qoder-sdk-transport.ts`、`opencode-adapter.ts` 约 1800–1900 行）继续堆新职责，新功能放到同包的独立模块。
6. 定向验证：`npx vitest run --config tests/vitest.config.js packages/adapters/<name>/test/<file>.test.ts`；改了 Manifest、依赖或预装清单时，再跑 `npm run build:typescript`（会执行 `build:plugins`）和 `npx vitest run --config tests/vitest.config.js tests/release/host-bundle.test.mjs`。
