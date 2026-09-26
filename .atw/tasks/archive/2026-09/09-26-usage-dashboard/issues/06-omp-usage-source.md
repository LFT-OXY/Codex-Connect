# 06 — 接入 oh-my-pi 用量

**What to build:** 本机 oh-my-pi 原生会话记录（含子代理文件）的用量进入统计，卡片同样可展开 Provider。

**Blocked by:** 05
**Status:** ready-for-agent
**Impl:** done

## Acceptance criteria

- [x] 实现前核实 oh-my-pi 的对话数口径，结论写回本任务 research；默认与 Pi 相同
- [x] oh-my-pi Adapter 实现原生用量读取，纳入子代理文件
- [x] Adapter 与 Host 请求层测试
- [x] 产品文档同步更新

## Implementation notes

- 读取器：`packages/adapters/omp/src/omp-native-usage.ts`（`readOmpNativeUsage(environment, cursor, signal)`），`OmpAdapter.nativeUsage` 经 `#usageAbort`/`#usageRequests` 接线（OMP 没有 Pi 的 `#readImport`）。规则见 `.atw/spec/adapter-omp/node/index.md`「原生用量」。Host、shared-contracts、Renderer 无改动：Provider 展开在 05 已对所有来源生效。
- 对话数：核实后与 Pi 相同（每条 assistant 消息，含 Token 为 0 的回复），结论写入 `research/discussion-decisions.md`「oh-my-pi 核实结论」。
- 与 Pi 的格式差异：会话头前有固定宽度的标题行；推理字段为 `reasoningTokens`，是输出的子集，按 Pi 同样方式拆出。PRD 的口径写「与 TokenTracker 一致」，但 TokenTracker 测试把 `reasoningTokens` 另加到总量上，与本机数据（`totalTokens` 不含它）不符，这里按契约「从 output 中扣除」处理，Token 总数与费用不重复计。
- 目录：除工单要求外，照 omp 自身行为支持 `PI_CODING_AGENT_SESSION_DIR`、`PI_CODING_AGENT_DIR`、`PI_CONFIG_DIR` 与 `$XDG_DATA_HOME/omp`；配置档（`OMP_PROFILE`/`PI_PROFILE`）未支持，产品文档已写明。
- 子代理：`<会话文件名>/<代理名>.jsonl`（可嵌套），递归扫描纳入；本机 177 个文件、约占 oh-my-pi Token 的 31%。
- 验证：本机 501 个文件 14,087 条去重记录的五项 Token 与对话数和独立 Python 求和逐项一致；首次全量约 0.9 s，无新增时增量约 30 ms。全量 TypeScript 测试中 `claude-code/test/command.test.ts`、`opencode/test/command.test.ts` 各 1 例失败，二者只测可执行文件查找，受本机已安装的 CLI 影响，与本工单无关。
