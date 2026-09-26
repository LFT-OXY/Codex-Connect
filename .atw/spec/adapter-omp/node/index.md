# adapter-omp（Node）

> 通用约定见 `.atw/spec/adapters/node/index.md`（plugin.ts 工厂、manifest、HarnessResult、command.ts、测试组织等）。本目录只写 OMP 特有内容。

`@codexhost/adapter-omp` 以 `omp --mode rpc-ui` 子进程（stdin/stdout JSONL）把 Oh My Pi（can1357/oh-my-pi）接入为 Harness。OMP 的 RPC 帧（含分块帧）、原生子代理事件、`--approval-mode` 权限、Session 文件格式都只在本包内处理。

- 依赖（`package.json`）：`@codexhost/harness-adapter`、`@codexhost/harness-discovery`、`@codexhost/shared-contracts`、`diff@8.0.2`。**不依赖** `@codexhost/adapter-pi`。
- 下游：Host 通过 `manifest.json` → `dist/plugin.js` 加载；预装由 `scripts/release/harness-plugins.json` 决定。
- 可执行文件：`CODEXHOST_OMP_COMMAND`（`src/plugin.ts`）优先，其次 `OMP_COMMAND` / 安装目录搜索（`src/command.ts` 的 `ompDiscoverySpec`）。
- 公开导出除 `OmpAdapter` 外，还有权限模式目录与编解码函数（`src/index.ts` 导出的 `omp-permission-modes.ts`）。

## 与 adapter-pi 的关系：复制分叉的并行实现，不同源

`git log` 显示本包由提交 `2d22d69c feat: integrate Oh My Pi harness` 一次性新增，`omp-adapter.ts`、`omp-rpc-session.ts`、`omp-history.ts`、`omp-last-turn-rollback.ts`、`omp-model-catalog.ts`、`omp-usage.ts`、`omp-session-file.ts` 与 Pi 同名文件的结构和函数名几乎一一对应（把 `Omp` 替换成 `Pi` 后逐行 diff，`omp-last-turn-rollback.ts` 只差空会话分支）。两者之间**没有 import 关系，也没有共享模块**，之后各自演化。主要分歧：

| 方面 | Pi | OMP |
|---|---|---|
| 启动模式 | `--mode rpc` | `--mode rpc-ui`（只有该模式才创建内置 `ask` 工具并连接工具 UI） |
| 恢复参数 | `--session F` | `--resume F` |
| 启动握手 | 直接 `get_state` | 等待 `ready` 帧，再发送 `negotiate_protocol {protocolVersion: 2}`（失败忽略），然后 `get_state` |
| 帧格式 | 单行 JSON | 另支持 `rpc_chunk` 分块重组（`OmpFrameDecoder`） |
| Turn 结束信号 | `agent_settled` | `agent_end` 且 `isTerminal !== false` |
| 压缩事件 | `compaction_start/end` | 另有 `auto_compaction_start/end`，并有 300 s `compactionTimeoutMs` 兜底 |
| 历史来源 | RPC `get_entries` | 有 `sessionFile` 时直接读 JSONL 文件；否则用 `get_messages` + `get_branch_messages` |
| Permission Mode | 不支持 | `always-ask` / `write` / `yolo`（默认 `yolo`） |
| 子代理 | `pi-subagents` 插件协议 | 原生 `subagent_lifecycle/progress/event` 帧 + `get_subagent_messages` |
| 工具项 | `toolExecution` | 投影成 `commandExecution`（`omp-tool-presentation.ts`） |
| 实时命令 | `get_commands` 拉取 | `available_commands_update` 推送，过滤掉 `builtin` |
| 自主 Turn / 凭据导入 / 空会话落盘 | 有 | 无 |
| 会话导入 | `pi-session-import.ts` | `omp-session-import.ts`（同构；见下文「会话导入」） |

修复两边共有的缺陷（进程清理、命令超时、交互关闭、Fork 校验）时，要同时检查另一侧；但不要抽共享层，协议细节必须留在各自的 Adapter 内。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [protocol-and-session.md](protocol-and-session.md) | 改 RPC 帧、启动握手、Turn 结算、交互、权限模式切换、子代理、历史/Fork/回滚时 |
| `docs/harnesses/omp/omp-interactions.md` | 改提问/审批映射、`optionDetails`、超时与取消语义前 |

## 源码地图（`packages/adapters/omp/src`）

| 文件 | 职责 |
|---|---|
| `omp-adapter.ts`（约 2580 行） | `OmpAdapter`（inspect/open/subagents.readSnapshot）与 Session 实现（Turn、交互、配置、权限模式重启、`/compact`、子代理事件） |
| `omp-rpc-session.ts`（约 1720 行） | `OmpRpcSession`：子进程、握手、命令关联与超时、事件归一化为 `OmpTurnEvent`、子代理帧解析 |
| `omp-protocol.ts` | `OmpFrameDecoder`（`rpc_chunk` 重组）与通知类型 |
| `omp-history.ts` / `omp-session-file.ts` / `omp-last-turn-rollback.ts` | 历史映射；读取 Session JSONL 与文件头 cwd 校验；回滚上一轮 |
| `omp-subagent-lifecycle.ts` | Turn 内 `subagentDelegation` 状态机 |
| `omp-native-usage.ts` | `nativeUsage.read` 的原生用量解析，规则见下文「原生用量」 |
| `omp-permission-modes.ts` / `omp-model-catalog.ts` / `omp-usage.ts` / `omp-slash-commands.ts` / `omp-tool-presentation.ts` | 权限目录；Model Ref；Usage；实时命令；工具项投影 |

## 原生用量（`omp-native-usage.ts`）

跨层契约见 `.atw/spec/host-runtime/node/local-usage.md`。规则与 Pi（`.atw/spec/adapter-pi/node/index.md`「原生用量」）相同的部分：递归列出 `*.jsonl`、不跟随符号链接；游标 `{ formatVersion: 3, files: { [相对路径]: { ino, mtimeMs, offset, session: {id, cwd?} | null, summary } } }`（v2 漏计技能发起的回合，升版本使摘要重算），任一项不合法整个作废；inode 变化或文件变短从头读；只读到最后一个 `\n`；`dedupeKey = message:<entry.id>:<entry.timestamp>`；每条带 `usage` 的 assistant 消息计 1 次对话（含 Token 全 0 的失败/中止回复，这类省略 `model` 与费用）；Provider、Model 取消息自身字段；`reportedCostUsd` 只在 `usage.cost.total > 0` 且有 Token 时填写。进度报告同 Pi（先 `0/N`，每个文件后 `i/N`）。`completeLines` 等辅助函数自带一份，不 import `adapter-pi`。OMP 特有（`test/omp-native-usage.test.ts` 固化；本机 501 个文件、14,087 条去重记录与独立脚本逐项一致）：

- 目录（`ompSessionsDirectory`，对照 omp 二进制内的 `agentSubdir(…, "sessions", "data")`）：`PI_CODING_AGENT_SESSION_DIR` → `path.resolve(PI_CODING_AGENT_DIR)/sessions` → 默认 `~/${PI_CONFIG_DIR || ".omp"}/agent/sessions`；agent 目录等于默认值且 `$XDG_DATA_HOME/omp` 是目录时改为 `$XDG_DATA_HOME/omp/sessions`。omp 对 `PI_CODING_AGENT_DIR` 只做 `path.resolve`、不展开 `~`，这里对两个变量都同样处理。**不支持**配置档 `OMP_PROFILE`/`PI_PROFILE`（`~/.omp/profiles/<名>/agent`）。
- 文件头：第一行通常是固定宽度、原地改写的标题行 `{type:"title", …, pad}`（偏移不变，游标仍有效），会话头 `type:"session"` 在其后；旧文件可能没有标题行。读取时跳过开头的 `title` 行，第一条非标题行不是带 `id` 的会话头 → `session: null`，整个文件不计。**会话头尚未完整写入时返回 `offset: 0`**（下次从头再判断），不要把「只读到标题行」记成非会话文件。
- 子代理：保存在以父会话文件名（不含 `.jsonl`）命名的目录里，`<会话文件名>/<代理名>.jsonl`，可再嵌套 `<代理名>/<子代理名>.jsonl`；会话头带自己的 `id`，少数带 `parentSession`。本机约占 oh-my-pi Token 的 31%。
- 推理字段是 `usage.reasoningTokens`（不是 Pi 的 `reasoning`），同样是 `output` 的子集（本机所有记录 `totalTokens = input + output + cacheRead + cacheWrite`）→ `reasoning = min(reasoningTokens, output)`，`output − reasoning`。不要像 TokenTracker 测试那样把它另加到总量上。
- 会话摘要：key = 相对路径；标题 = 标题槽（原地改写，`mtimeMs` 变化时重读首行）→ 会话头 `title` → 首条用户消息（截到 120 字）；轮数、编辑工具（`edit`/`write`）同 Pi，另把 `ompUserCustomMessage`（`custom_message` 且 `attribution === "user"`、`display === true`，本机只有 `skill-prompt`）算作一轮但不用作标题——OMP 以技能开始的会话没有 `role:"user"` 消息；`attribution:"user"` 但 `display:false` 的是注入的上下文（如 `atw-workflow-state`），不算；子代理的父会话 = 所在文件夹对应的 `<文件夹>.jsonl` 的会话 ID（全部文件读完后再产出摘要，保证父文件已读）；Fork（`parentSession` 是文件路径）不作父会话，单独成行。`nativeUsage.resumeCommand(id)` = `omp --resume <id>`。
- `nativeUsage.read` 与 `sessionImport` 在 `OmpAdapter` 内经 `#readNative`（`#readAbort` / `#readRequests`）收口：关闭后返回 `invalidState`，`close()` 先 abort 再等待进行中的读取；读取抛错映射为 `{ code: "unavailable", retryable: true }`。读取用 `{ ...process.env, ...options.environment }`，与会话启动的环境一致。

## 会话导入（`omp-session-import.ts`）

与 Pi 的 `PiSessionImportIndex` 同构（指纹缓存、只读重新校验、重复 ID 明确失败、变化中的文件跳过）；`ompSessionsDirectory` 也在此文件，用量读取器从这里引用。差异：`ompUserCustomMessage` 也算活动分支上的用户消息（本机因此从 229 个候选增加到 267 个）；扫描会话目录本身与下一层，与会话文件同名的文件夹是子代理，跳过；会话头之前可有标题槽；标题 = 标题槽 → 会话头 `title` → 首条用户消息；`nativeRef.locator.sessionFile` = 真实路径，已有 `resume` 用它恢复。`test/omp-session-import.test.ts` 固化。

## 技术债

- `omp-adapter.ts` 约 2580 行、`omp-rpc-session.ts` 约 1720 行，远超 800 行审视线，新能力放独立的 `omp-*.ts` 模块。
- 能力声明在 Session 构造函数（约 633 行）和 `#inspectCwd`（约 2277 行）两处重复，改动需同步。

## 改动前检查清单

1. 不要把启动模式改回 `rpc`：普通 `rpc` 不创建 `ask` 工具，`omp-native-ask.test.ts` 的原生回归测试会失败（见 omp-interactions.md）。
2. 新 RPC 命令要处理 `OmpRpcUnsupportedCommandError`（`Unknown command: <type>`），并决定是降级还是报错。
3. 改权限模式时保持“关闭旧进程 → 以 `--resume` 加新 `--approval-mode` 重启 → 校验 Session ID 不变；失败则用旧模式恢复，恢复也失败时 fault”这一流程。
4. `select` 的 `optionDetails` 与 `options` 长度不一致或类型非法时判为协议错误，不要把说明绑到错误的选项上。
5. 审批只映射一次性的 `Approve`/`Deny`，不要扩大成永久允许。
6. 改 `OmpFrameDecoder` 时保持上限：单帧 ≥ 1 MiB 才允许分块、重组后 ≤ 64 MiB、单块 ≤ 256 KiB，序号必须连续，base64 必须规范。

## 定向验证

```bash
npx vitest run --config tests/vitest.config.js packages/adapters/omp/test/omp-rpc-session.test.ts packages/adapters/omp/test/omp-adapter.test.ts
npx vitest run --config tests/vitest.config.js packages/adapters/omp/test/omp-protocol.test.ts packages/adapters/omp/test/omp-session-file.test.ts packages/adapters/omp/test/omp-slash-commands.test.ts packages/adapters/omp/test/omp-native-usage.test.ts
# 原生 ask 回归（macOS/Linux，本地模型夹具，不调用外部模型；未设置时跳过）
CODEXHOST_OMP_NATIVE_TEST_COMMAND=$(which omp) \
  npx vitest run --config tests/vitest.config.js packages/adapters/omp/test/omp-native-ask.test.ts
```
