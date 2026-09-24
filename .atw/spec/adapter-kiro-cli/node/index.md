# adapter-kiro-cli（Node）

> 通用约定见 `.atw/spec/adapters/node/index.md`（plugin.ts 工厂、manifest、HarnessResult、command.ts、测试组织）。本目录只写 Kiro CLI 特有的内容。

`@codexhost/adapter-kiro-cli` 通过 Kiro CLI 原生 ACP v3 引擎（`kiro-cli acp --agent-engine v3 --auth-method cli`，见 `src/command.ts#kiroInvocation`）运行 Kiro Session。ACP 协议、Kiro `_meta.kiro` 扩展、原生会话目录解析都只在本包内处理，不外泄到 Host。

- 运行时依赖（`package.json`）：`@agentclientprotocol/sdk@1.3.0`、`@codexhost/harness-adapter`、`@codexhost/harness-discovery`、`@codexhost/shared-contracts`、`diff`。
- `devDependencies` 里的 `@codexhost/protocol-core` 只给测试用：`test/*.test.ts` 用 `CodexTurnProjector`、`projectCodexApprovalRequest`、`projectHistoricalTurn` 验证投影结果能被 Host 协议层消费。`src/` 不得导入它。
- 预装入口：`scripts/release/harness-plugins.json` 列出 `packages/adapters/kiro-cli`。
- 包内 `README.md` 记录了异步 Model 确认、配置超时 fault、并发交互三项设计。已与代码核对，内容一致。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [acp-transport.md](acp-transport.md) | 修改 `acp-transport.ts`、配置写入（Model / Thinking / Permission Mode）、审批与 Question、Harness 命令 |
| [session-history.md](session-history.md) | 修改原生历史读取、Fork / 回滚、回合输出投影、Usage、子代理、文件 Diff |

源码职责速查：

| 源文件 | 职责 |
|---|---|
| `src/acp-transport.ts`（约 960 行） | 子进程、ACP 连接、`session/fork`、配置确认、`_kiro/*` 扩展请求 |
| `src/kiro-adapter.ts`（约 1500 行） | `KiroAdapter`（inspect 缓存、open 四种形态）与 `KiroSession`（回合、交互、配置、命令） |
| `src/history.ts` | 读取 `~/.kiro/sessions/**/messages.jsonl`，识别回合边界、Fork 点和快照 |
| `src/turn-output.ts` / `src/visible-text.ts` | 实时回合 Item 投影，以及过滤泄漏的工具前导文本 |
| `src/projection.ts` | 审批、需求问题、`_kiro/userInput` 和工具调用到 Host Item 的投影 |
| `src/models.ts` / `src/permission-modes.ts` | configOptions 到 Model 目录、effort、autopilot 的映射 |
| `src/commands.ts` / `src/kiro-slash-commands.ts` | 静态 Harness 命令，以及 ACP 推送的实时命令 |
| `src/usage.ts` / `src/file-diff.ts` | credits 与上下文百分比；ACP `diff` 内容到 `HostFileChange` |

## 已知技术债

- `src/kiro-adapter.ts` 约 1500 行，同时容纳 Adapter、Session、命令执行，`src/acp-transport.ts` 约 960 行。这两个文件都不要再塞新职责。新的投影、格式化或解析逻辑放进独立模块，参照 `turn-output.ts`、`usage.ts`、`commands.ts#formatKiroCommandResult` 的拆法。
- `KiroAcpTransportLike`（`kiro-adapter.ts`）是测试注入用的接口。Transport 新增方法时要同步更新它，并保持可选，让旧 Transport 仍能满足接口（参见 `availableCommands?`）。

## 改动前检查清单

1. 改传输层前，先对比 `packages/adapters/grok/src/acp-transport.ts`。两者结构高度相似，但各自独立实现：`classifyStartupError`、`withTimeout`、`waitForExit`、`signalProcessTree` 同名不共享。另外还要看 `packages/adapters/kimi-code/src/acp-transport.ts`（直接 `child.kill`，没有进程组）和 `packages/adapters/cursor-cli/src/transport.ts`，判断是否有同类缺陷需要一起修。
2. 配置写入必须经 `confirmedKiroConfig` 拿到原生确认后再更新状态。不要在 RPC 发出后乐观地发布 `session.state.changed`。
3. 新增 Kiro 扩展方法或 `_meta.kiro` 字段时，先确认 Kiro 真实支持。不支持就返回 `unsupported` / `invalidRequest`，不要伪造等价行为，例如用普通 Prompt 冒充 `/compact`。
4. Fork 和回滚的边界只能取自原生 `messages.jsonl`（`findForkBoundary` / `findRollbackBoundary`）。原生已经不保留的位置返回 `checkpointNotFound` 或 `unsupported`，不要改用相邻位置代替。
5. 改 `projection.ts` 的审批动作时，要保证 action ID 唯一（`responses.size !== actions.length` 会抛错），并且 `allow_always` 只在 consent 允许持久化时才展开。
6. 定向验证：`npx vitest run --config tests/vitest.config.js packages/adapters/kiro-cli/test/<file>.test.ts`。传输层或配置相关的改动至少跑 `acp-effort.test.ts` 和 `acp-session-lifecycle.test.ts`。
