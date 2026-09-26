# adapter-pi（Node）

> 通用约定见 `.atw/spec/adapters/node/index.md`（plugin.ts 工厂、manifest、HarnessResult、command.ts、测试组织等）。本目录只写 Pi 特有内容。

`@codexhost/adapter-pi` 以 `pi --mode rpc` 子进程（stdin/stdout JSONL）把 Pi（`@earendil-works/pi-coding-agent`）接入为 Harness。Pi 的 RPC 帧、v3 Session 文件格式、`pi-subagents` 插件协议、Pi 凭据存储都只在本包内处理。

- 依赖（`package.json`）：`@codexhost/harness-adapter`、`@codexhost/harness-discovery`、`@codexhost/shared-contracts`、`diff@8.0.2`（从工具参数合成 Unified Diff）。
- 下游：Host 通过 `manifest.json` → `dist/plugin.js` 加载；预装由 `scripts/release/harness-plugins.json` 决定（列表第一项）。
- 可执行文件：`CODEXHOST_PI_COMMAND`（`src/plugin.ts`）优先，其次 `PI_COMMAND` / 安装目录搜索（`src/command.ts` 的 `piDiscoverySpec`）。
- 与 `adapter-omp` 的关系：OMP 是从本包复制后独立演化的并行实现，没有共享代码，详见 `.atw/spec/adapter-omp/node/index.md`。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [rpc-and-session.md](rpc-and-session.md) | 改 RPC 传输、进程生命周期、Turn 结算/取消、压缩、自主 Turn、交互、命令、Model/Thinking、Usage、凭据或会话导入时 |
| [history-and-subagents.md](history-and-subagents.md) | 改历史映射、Checkpoint、Fork、回滚上一轮、空会话持久化、`pi-subagents` 子代理映射时 |
| `docs/harnesses/pi/pi-subagents.md` | 子代理协议版本、尺寸上限和验证范围的权威说明 |
| `docs/harnesses/pi/pi-edit-recovery.md` | 空历史编辑恢复与 `tools/gate-pi` 覆盖范围 |
| `docs/harnesses/capability-boundaries.md`（“Pi 权限模式”一节） | 想给 Pi 加 Permission Mode 之前 |

## 源码地图（`packages/adapters/pi/src`）

| 文件 | 职责 |
|---|---|
| `pi-adapter.ts`（约 2490 行） | `PiAdapter`（inspect/open/subagents.readSnapshot/sessionImport/credentialImports）与 `PiHarnessSession`（Turn、交互、配置、`/compact`、自主 Turn、Usage） |
| `pi-rpc-session.ts`（约 1590 行） | `PiRpcSession`：子进程、JSONL 编解码、命令关联与超时、事件归一化为 `PiTurnEvent`、取消与关闭 |
| `pi-history.ts` | `mapPiSnapshot`、`activePiEntries`、Fork/回滚边界解析 |
| `pi-last-turn-rollback.ts` / `pi-empty-session.ts` / `pi-session-file.ts` | 回滚上一轮；空 Fork 以 v3 格式落盘与冷恢复配置；Session 文件头与 cwd 校验 |
| `pi-subagents.ts` / `pi-subagent-rpc.ts` / `pi-subagent-history.ts` | 异步子代理状态 widget、检查 RPC、父历史恢复 |
| `pi-subagent-workflow.ts` / `pi-workflow-child-history.ts` | 同步 workflow `workflowChildren` 摘要与只读子 Session 读取 |
| `pi-model-catalog.ts` / `pi-usage.ts` / `pi-slash-commands.ts` | Model Ref 编解码与 Thinking 目录；Usage；实时命令目录 |
| `pi-session-import.ts` / `pi-credential-imports.ts` | 原生 Session 导入索引；订阅凭据导入（写 Pi `auth.json` 与扩展） |
| `pi-native-usage.ts` | `nativeUsage.read` 的原生用量解析，规则见下文「原生用量」 |

## 原生用量（`pi-native-usage.ts`）

跨层契约见 `.atw/spec/host-runtime/node/local-usage.md`。Pi 特有规则（`test/pi-native-usage.test.ts` 固化；本机 786 个文件、19,028 条去重记录与独立脚本逐项一致）：

- 进度：列出文件后 `onProgress?.({ processed: 0, total: files.length })`，每个文件处理完（包括读取中被删除而跳过的）后报 `index + 1`；Adapter 的 `nativeUsage.read(cursor, onProgress)` 原样传给读取函数（`read…NativeUsage(environment, cursor, signal, onProgress)`）。
- 目录：复用 `piSessionImportDirectory`（`PI_CODING_AGENT_SESSION_DIR`，否则 `$PI_CODING_AGENT_DIR/sessions`，默认 `~/.pi/agent/sessions`），但**递归**列出所有 `*.jsonl`，不跟随符号链接。子代理扩展把子会话放在父会话目录内（`<project>/<session>/tasks/*.jsonl`、`<project>/<hash>/run-N/*.jsonl`，头部带 `parentSession`），本机约占 Pi 用量两成。会话导入的 `sessionFiles` 只扫一层是为了不把子会话当可导入会话，不要为用量改它。
- 游标 `{ formatVersion: 1, files: { [相对 sessions 目录的路径]: { ino, offset, session: {id, cwd?} | null } } }`。`session` 是第一行会话头（`type:"session"` 且有 `id`），用于解析 offset 之后的行；第一行不是会话头 → `session: null`，整个文件不计。Adapter 没有 zod 依赖，`parseCursor` 手写校验，**任一项不合法整个游标作废**（等同 `null`，从头读），不要逐项丢弃。inode 变化或文件变短从头读。只读到最后一个 `\n`。
- 用量：`type:"message"`、`message.role === "assistant"` 且有 `message.usage` 的行（先用 `'"usage"'` 字符串预过滤）。`@earendil-works/pi-ai` 的 `Usage.reasoning` 是 `output` 的子集 → `reasoning = min(reasoning, output)`，`output = output − reasoning`（契约允许的「从 output 中扣除」；Token 总数与费用不变，推理列有值）。`input`、`cacheRead`、`cacheWrite` 原样（Pi 的 `input` 本就不含缓存）。
- 身份：`dedupeKey = message:<entry.id>:<entry.timestamp>`。Fork/恢复把 entry 连 id 与时间戳原样复制（本机 146 例全部相同）；entry id 只有 8 位十六进制，加时间戳避免无关会话撞键。`occurredAt` = `entry.timestamp`；`nativeSessionId`、`cwd` 取本文件会话头。
- `provider`、`model` 取消息自身字段。对话数：每条 assistant 消息 `conversations: 1`，包括失败/中止、Token 全 0 的回复（本机约 300 条）；这类记录省略 `model`（契约：只计对话的记录）与费用，保留 `provider`。
- `reportedCostUsd`：只在 `usage.cost.total > 0` 且有 Token 时填写。Pi 对订阅通道和未配置价格的自定义 Provider 都写 0，无法区分免费与未知（本机几乎全部为 0，只有 `xai` 有正值），按契约「未知不能记 0」交给 Host 按 LiteLLM 估价。
- Pi 只在 `message_end` 后整条追加，不存在流式部分用量，不需要 Claude 那样的等待窗口。
- `completeLines` 等辅助函数与 Claude、Codex 读取器各有一份：Adapter 之间、Adapter 与 host-runtime 之间不能共享（ADR-0002、边界规则），oh-my-pi 的读取器（`packages/adapters/omp/src/omp-native-usage.ts`）同样自带一份。

## 技术债

- `pi-adapter.ts` 约 2490 行、`pi-rpc-session.ts` 约 1590 行，远超 800 行审视线。新能力按现有做法放独立模块（参考 `pi-last-turn-rollback.ts` 以最小 transport 接口注入、`pi-subagent-*.ts` 纯函数解析），不要继续往这两个文件里加职责。
- `pi-adapter.ts` 与 `omp-adapter.ts`、`pi-rpc-session.ts` 与 `omp-rpc-session.ts` 是复制分叉的平行实现。修复进程清理、超时、交互关闭等通用缺陷时，要同时检查 OMP 对应代码是否有同样问题；但不要抽共享层（协议细节必须留在各自 Adapter）。

## 改动前检查清单

1. 新 RPC 命令一律走 `#send()` 并接受 `PiRpcUnsupportedCommandError`：旧版 Pi 对未知命令返回 `Unknown command: <type>`，调用方要决定是降级（如 `get_available_thinking_levels` 返回 `null`）还是报错，不要把它当成协议故障。
2. 任何会改变原生状态的命令（`set_model`、`set_thinking_level`、`fork`、`clone`）之后必须 `#refreshState()` 回读 `get_state` 确认，未确认就 `#fail`，不要乐观发布状态。
3. 能力声明在 `PiHarnessSession` 构造函数和 `PiAdapter.#inspectCwd` 两处重复出现，改一处必须同步另一处。
4. 不要给 Pi 添加 Permission Mode：`open(create)` 收到 `permissionModeId` 时返回 `unsupported`，这是有意为之（见 capability-boundaries.md）。
5. 改 Fork/回滚时保留“新 Native Session ID 必须不同于源和启动 ID”“派生历史 Turn 数与 checkpoint 精确匹配”“`verifySessionCwd`”三项校验。
6. 改子代理解析时保持协议版本、前缀、尺寸上限不变（`PI_SUBAGENT_ASYNC_JSON:`、`pi-subagents-v1:`、`pi-subagents-workflow-v1:`、64 KiB/8 MiB/1 MiB），未知版本当普通工具处理，不要推断完成状态。
7. 改进程启动参数时维护 `piRpcProcessCommand` 的互斥规则（`--session` 与 `--fork` 互斥，启动 Model 不能与恢复/Fork 组合），以及 Windows `.cmd/.bat` 的 `cmd.exe /d /v:off /s /c` 引号转义。

## 定向验证

```bash
npx vitest run --config tests/vitest.config.js packages/adapters/pi/test/pi-native-usage.test.ts packages/host-runtime/test/local-usage.test.ts
npx vitest run --config tests/vitest.config.js packages/adapters/pi/test/pi-rpc-session.test.ts packages/adapters/pi/test/pi-adapter.test.ts
npx vitest run --config tests/vitest.config.js packages/adapters/pi/test/pi-history.test.ts packages/adapters/pi/test/pi-empty-session.test.ts packages/adapters/pi/test/pi-session-file.test.ts
npx vitest run --config tests/vitest.config.js packages/adapters/pi/test/pi-subagents.test.ts packages/adapters/pi/test/pi-subagent-workflow.test.ts packages/adapters/pi/test/pi-subagent-rpc.test.ts packages/adapters/pi/test/pi-subagent-history.test.ts
# 真实 CLI 生命周期 Gate（导入 dist，需先构建；未设置命令时整组跳过）
npm run build:typescript && CODEXHOST_PI_REAL_COMMAND=$(which pi) \
  npx vitest run --config tests/vitest.config.js tools/gate-pi/lifecycle.real.test.mjs
```
