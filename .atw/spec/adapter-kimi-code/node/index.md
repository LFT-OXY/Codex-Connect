# adapter-kimi-code（Node）

> 通用约定见 `.atw/spec/adapters/node/index.md`（plugin.ts 工厂、manifest、HarnessResult、command.ts、测试组织）。本目录只写 Kimi Code 特有的内容。

`@codexhost/adapter-kimi-code` 通过 `kimi acp`（ACP v1，stdio NDJSON）把 Kimi Code CLI 接入为 Harness。原生历史从 `KIMI_CODE_HOME` 下的 `wire.jsonl` 读取；回滚借助临时拉起的原生 `kimi web` 服务完成。插件不修改 Kimi 的 wire/state 文件，唯一例外是插件自有的命令日志 `codexhost-commands.jsonl`。

## 依赖

`package.json#dependencies`：

- `@agentclientprotocol/sdk@1.3.0`：`ClientSideConnection`、`ndJsonStream`
- `@codexhost/harness-adapter`、`@codexhost/harness-discovery`（可执行文件解析、`commandInvocation`）、`@codexhost/shared-contracts`
- `diff`：历史中的 fileChange 统一 diff（`createTwoFilesPatch`）
- `smol-toml`：解析 `~/.kimi-code/config.toml`

没有 devDependencies，测试全部通过注入假 transport 或 mock `node:child_process` 完成。

## 文件清单

| 文件 | 职责 | 何时阅读 |
|---|---|---|
| [protocol-and-session.md](protocol-and-session.md) | ACP 传输、Adapter 与 Session 的分工、配置确认、交互、回合关联 | 改 `acp-transport.ts`、`kimi-adapter.ts`、`kimi-session.ts`、`models.ts`、`projection.ts`、`slash-commands.ts` 之前 |
| [history-and-rollback.md](history-and-rollback.md) | 原生会话定位、wire.jsonl 分支解析、命令日志、Fork、回滚 | 改 `history.ts`、`wire-history.ts`、`command-history.ts`、`native-rollback.ts`，或改 fork/rollback 分支之前 |

源码主要文件：`src/kimi-session.ts`（约 1220 行）、`src/history.ts`（约 755 行）、`src/kimi-adapter.ts`（约 690 行）、`src/acp-transport.ts`（约 675 行）。

## 能力现状（`kimiSessionCapabilities`，`src/kimi-session.ts`）

- `configuration`：Model、Thinking、Permission Mode 均可选，`permissionModeScope: "live"`。
- `history.fork: true`，`forkAcrossCwd: false`，`rollbackLastTurn: true`。
- `subagents.observe/readTranscript: false`。`parseKimiWireLog` 会跳过所有 `agentId !== "main"` 的记录（`src/history.ts`），插件目前不投影子代理。
- `autonomousTurns.observe: false`。
- 不支持 `unattended-full-access`：`KimiAdapter.open` 在 create 时直接返回 `unsupported`（测试："rejects an unverified unattended execution policy before creating a session"）。
- 没有上下文压缩投影。`/compact` 只是原生 slash command，作为命令回合执行，不产生 `contextCompaction` Item。

## 改动前检查清单

1. 改动 ACP 传输时，先确认你要改的是哪一份 transport。`grok/src/acp-transport.ts` 与 `kiro-cli/src/acp-transport.ts` 彼此高度相似，都用 detached 进程组、`signalProcessTree`/`taskkill /t` 和 `classifyStartupError`；Kimi 的 `acp-transport.ts` 是独立实现，直接调用 `child.kill`，没有进程组；`cursor-cli/src/transport.ts` 又是另一套。修复通用缺陷（超时、退出清理、stderr 脱敏）时，逐个检查这四个文件，但不要把它们合并成共享层。
2. 配置写入必须以原生响应确认：写入后重新读取 `configOptions`，与请求值比对（`applyRequestedConfig`、`#handleModelSelect` 等）。不能用本地猜测的值替代。
3. Thinking 列表只能来自当前会话 ACP `configOptions`（见 `docs/harnesses/capability-boundaries.md`「Kimi Thinking 配置」）。不要从 `config.toml` 推断 `medium`、`off/on`，也不要把旧选择映射到新值。
4. 回合成功必须对应一个持久化的 Native Turn：`#waitForNativeTurn` 找不到唯一匹配时返回 `protocolError`，不得报告成功。
5. 不要直接改写 Kimi 原生文件（`wire.jsonl`、`state.json`、`session_index.jsonl`）。回滚和 fork 走原生接口，命令回合只写 `codexhost-commands.jsonl`。
6. `kimi-session.ts` 已约 1220 行，`#runTurnBody` 单个方法就有约 480 行。新增功能应放入独立模块，例如 `projection.ts` 或新文件，由 Session 调用，不要继续往 Session 里堆。
7. 改动后定向运行：
   ```bash
   npx vitest run --config tests/vitest.config.js packages/adapters/kimi-code/test
   npx vitest run --config tests/vitest.config.js packages/adapters/kimi-code/test/review-regressions.test.ts
   ```
