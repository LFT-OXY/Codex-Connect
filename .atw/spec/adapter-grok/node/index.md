# adapter-grok（Node）

> 通用约定见 `.atw/spec/adapters/node/index.md`（plugin.ts 工厂、manifest、HarnessResult、command.ts、测试组织等）。本目录只写 Grok 特有内容。

`@codexhost/adapter-grok` 通过 Grok CLI 的原生 ACP（`grok agent --no-leader [--model <id>] stdio`，见 `src/command.ts` 的 `grokInvocation`）把 Grok Build 接入为 Harness。xAI 私有扩展（`_x.ai/*`、`x.ai/*`）、原生 Session 文件格式和 Grok 账户接口都只存在于本包。

- 依赖（`package.json`）：`@agentclientprotocol/sdk@1.3.0`、`@codexhost/harness-adapter`、`@codexhost/harness-discovery`、`@codexhost/shared-contracts`、`diff`（生成 fileChange 的 Unified Diff）。
- 下游：Host 通过 `manifest.json` → `dist/plugin.js` 加载本包；插件是否预装由 `scripts/release/harness-plugins.json` 决定。
- 覆盖路径：可执行文件可用 `CODEXHOST_GROK_COMMAND` 覆盖（`src/plugin.ts` 的 `GROK_COMMAND_ENV`），原生目录可用 `GROK_HOME` 覆盖（`acp-transport.ts` 的 `grokHomeDir`）。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [protocol-and-session.md](protocol-and-session.md) | 改 ACP 传输、进程生命周期、扩展方法、模型/思考/权限模式、审批、`/compact`、Usage/Credits、工具输出或媒体改写时 |
| [history-fork-rewind.md](history-fork-rewind.md) | 改原生历史映射、Checkpoint、Turn 结算、Fork、回滚上一轮或子代理时 |
| `docs/harnesses/grok/subagent-status-and-model.md` | 改子代理状态、子代理 Model 字段或 Desktop 子代理投影前 |

## 源码地图（`packages/adapters/grok/src`）

| 文件 | 职责 |
|---|---|
| `grok-adapter.ts`（约 1900 行） | `GrokAdapter`（inspect/open/credits/subagents.readSnapshot）与 `GrokHarnessSession`（Turn、审批、配置、`/compact`、结算） |
| `acp-transport.ts`（约 980 行） | `GrokAcpTransport`：子进程、ACP 连接、事件归一化为 `GrokTransportEvent`、原生目录读取 |
| `grok-history.ts` | `mapGrokReplay`：原生 `updates.jsonl` 事件 → `HostThreadSnapshot` |
| `grok-fork.ts` / `grok-rewind.ts` | 原生 Fork / Rewind 的参数、响应解析和前后缀校验 |
| `grok-models.ts` / `permission-modes.ts` | Model 目录与 Thinking；三种原生权限模式 |
| `grok-subagent.ts` / `grok-subagent-lifecycle.ts` | 子代理工具识别、原生事件解析；Turn 内 `subagentDelegation` 状态机 |
| `grok-compaction.ts` / `grok-manual-compaction.ts` | 自动压缩事件；手动 `/compact` RPC 与结果解析 |
| `grok-usage.ts` / `grok-credits.ts` / `grok-credential-export.ts` | Usage 汇总；账户额度；OAuth 凭证导出 |
| `grok-tool-output.ts` / `grok-file-change.ts` / `local-media-markdown.ts` | 工具项投影；ACP Diff → fileChange；本地媒体路径改写 |
| `grok-slash-commands.ts` | 解析 `available_commands_update`，生成动态命令 |

## 技术债

- `grok-adapter.ts` 约 1900 行，`acp-transport.ts` 约 980 行，都已超过 800 行的审视线。新能力应放进独立的 `grok-*.ts` 模块（参考 `grok-fork.ts`、`grok-rewind.ts` 用依赖注入的纯函数写法），不要再往这两个文件里加职责。
- ACP 传输是各 Adapter 独立实现的，没有共享代码：`kiro-cli/src/acp-transport.ts` 与本包结构几乎一致（同名的 `classifyStartupError`、`withTimeout`、`waitForExit`、`signalProcessTree`，detached 进程组加 Windows `taskkill`）；`kimi-code/src/acp-transport.ts` 自成一套（用 `child.kill`，不建进程组）；`cursor-cli/src/transport.ts` 又是另一套。修复传输层问题时，要逐个检查这几个同类文件是否有同样的缺陷，但不要为此抽公共层（CLAUDE.md 要求 Harness 协议细节留在各自的 Adapter 内）。

## 改动前检查清单

1. 新增的 xAI 扩展方法名写成常量，放在对应模块里（例如 `GROK_SESSION_FORK_METHOD`），并确认它是否带下划线前缀。现有方法中两种写法都有，手动压缩还需要回退调用（见 protocol-and-session.md）。
2. Grok 不支持的能力返回 `unsupported`。Method Not Found 统一用 `isGrokMethodNotFound`（`grok-fork.ts`）判断，不要伪造等价行为。
3. 改动历史映射时，确认 live Turn 结算仍然满足“恰好新增 1 个 Native Turn”（`#settleFromHistory`），并且 `nativeTurnKey` 在 live 和 resume 两条路径上保持一致。
4. 改动 Fork/Rewind 时，保留前缀比对，以及失败后删除子会话的清理步骤（`forkGrokSession` 的 `cleanup`）。
5. 子代理的 Model 或 reasoningEffort 只能来自原生事实（spawn 参数或 `subagent_spawned` 事件），不要从父会话配置推断。
6. 修改 `acp-transport.ts` 的关闭、超时或进程组逻辑后，同步检查 kiro-cli、kimi-code、cursor-cli 的同类文件。
7. 能力声明集中在 `capabilitiesForModels`（`grok-adapter.ts`）。改动后同时更新 `inspect()` 和 Session 两处都会用到的声明，并补充测试。

## 定向验证

```bash
npx vitest run --config tests/vitest.config.js packages/adapters/grok/test/grok-adapter.test.ts
npx vitest run --config tests/vitest.config.js packages/adapters/grok/test/grok-history.test.ts packages/adapters/grok/test/grok-fork.test.ts packages/adapters/grok/test/grok-rewind.test.ts
npx vitest run --config tests/vitest.config.js packages/adapters/grok/test
```
