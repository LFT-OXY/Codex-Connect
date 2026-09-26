# 05 — 接入 Pi 用量与 Provider 展开

**What to build:** 本机 Pi 原生会话记录的用量进入统计；Pi 卡片可展开查看各 Provider 占比。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

## Acceptance criteria

- [x] Pi Adapter 实现原生用量读取：遵循 PI_CODING_AGENT_DIR；读取 assistant 消息的 input/output/cacheRead/cacheWrite/reasoning；Provider 取自消息；按 entry id 去重；未写完的文件尾不读
- [x] 对话数按每条 assistant 消息计
- [x] Harness 卡片支持展开到 Provider 子项，占比极小时显示「<0.01%」
- [x] Adapter 与 Host 请求层测试覆盖 Provider 子项
- [x] 产品文档同步更新

## Implementation notes

- 读取器：`packages/adapters/pi/src/pi-native-usage.ts`（`readPiNativeUsage(environment, cursor, signal)`），`PiAdapter.nativeUsage` 经 `#readImport` 接线。结果契约 `harnesses[].providers[{provider,totalTokens,models}]`（shared-contracts），Host `local-usage-view.ts` 聚合非 null Provider，Renderer 在卡片内用 `<details>` 展开，占比 = Provider ÷ 该 Harness；`formatUsageShare` 让 0 < 占比 < 0.005% 显示「<0.01%」（Harness 卡片、横条 title 与 Provider 子项共用）。规则细节见 `.atw/spec/adapter-pi/node/index.md`「原生用量」与 `.atw/spec/host-runtime/node/local-usage.md`。
- 读取范围：研究记录写的是 `sessions/**/*.jsonl`，实现递归扫描，纳入子代理扩展保存在父会话目录内的子会话（`tasks/`、`run-N/`，本机 298 个文件、约 4.1 亿 Token）；会话导入仍只扫一层。同时沿用 Pi CLI 的 `PI_CODING_AGENT_SESSION_DIR` 覆盖。
- 推理：研究记录中的字段名 `reasoningTokens` 有误，Pi 实际字段是 `usage.reasoning`，且官方类型注明它是 `output` 的子集。实现按契约「从 output 中扣除」：`output − reasoning` 计输出、`reasoning` 计推理，Token 总数与费用不变（与 Codex 报 0 的做法不同，Codex 的推理列仍为 0）。
- 去重键：`entry.id + entry.timestamp`（比「按 entry id」更严），Fork 复制时两者都不变；8 位 entry id 单独使用在无关会话间有撞键风险。
- 对话数：每条 assistant 消息计 1，包括 Token 为 0 的失败/中止回复（省略 model）。本机所有 assistant 消息都带 `usage`，没有 usage 的不计。
- 费用：Pi 自记费用只在 > 0 时作为 `reportedCostUsd`；为 0（订阅、自定义 Provider）按 LiteLLM 估价。
- Provider 展开对所有记录了 Provider 的来源生效，官方 Codex 卡片也会出现单项「Provider（1）」；Host 不按 Harness 区分。若只想在 ≥2 个 Provider 时展开，改 Renderer 条件即可（待用户确认）。
- 验证：本机 786 个文件 19,028 条去重记录的五项 Token 与对话数和独立 Python 求和逐项一致，首次全量约 1.1–2.8 s，无新增时增量约 0.1–0.4 s。e2e 在本机需用系统 Chrome（`channel: "chrome"`）运行，仓库 Playwright 版本的浏览器未安装。
