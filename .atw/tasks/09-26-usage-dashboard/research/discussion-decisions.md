# 讨论结论：本地用量仪表盘

来源：2026-09-25～26 与用户的需求访谈（atw-askme-with-docs）。参考对象为 TokenTracker（MIT，`/Users/oxy/Documents/Configuration/dev-environment/demo/源码/TokenTracker`）的仪表盘截图与源码。

## 用户已决定

- Q1 数据来源：读取本机各 Harness 的原生会话记录（Local Usage），终端直接使用 CLI 的用量也计入；不由 Host 记账。见 ADR-0001。
- Q2 覆盖范围：Claude Code、Codex、Pi、oh-my-pi；其他以后按同一接口添加。
- Q3 承载位置：设置对话框中新增「用量」标签页；打开时对话框放大到接近整个窗口。入口只有现有设置按钮（Q20）。
- Q5 第一版包含：日/周/月/总计/自定义周期切换；Token 总数与费用；按 Harness 的占比卡片；7 天/30 天/平均/对话数统计块；每日明细表；项目用量。
  不包含：3D 热力图、2D 热力图、趋势柱状图、预测值、分享卡片、拖拽布局、Top 模型排行。
- Q6 费用：运行时从 LiteLLM 公开价格表拉取（24 小时缓存），失败用内置快照兜底，另有手工覆盖；界面不额外标注「按 API 价格估算」，与 TokenTracker 一致。术语上称 Estimated Cost。
- Q7 分组维度：按 Harness 分组；Pi、oh-my-pi 这类多 Provider 的 Harness 可在卡片内展开到 Provider。
- Q8′ 代码复用：不照抄，参照思路自行实现，不带原作者署名（用户明确要求不署名；照抄且去掉 MIT 声明违反其许可证，故改为自行实现）。
- Q11 对话数：沿用 TokenTracker 口径（各 Harness 不同，不可互相比较）。
- Q12 项目识别：有 Git 远程地址按 `owner/repo`，没有则按文件夹名。
- Q13 更新时机：打开页面时增量读取，另有刷新按钮；首次读取显示进度。
- Q15 解析归属：各 Harness 原生记录的解析放在各自 Adapter；官方 Codex 放在 host-runtime 的 Codex 运行时。见 ADR-0002。

## Agent 替用户定的小事（用户已在总结中确认）

- 周从周一开始；「总计」「平均」口径与每日明细表列照 TokenTracker；按本机时区分日。

## 调研事实

- 本机数据量（2026-09-25）：`~/.claude/projects` 964M（1594 文件）、`~/.pi/agent/sessions` 483M（784 文件）、`~/.omp` 1.2G（记录在 `~/.omp/agent/sessions`）、`~/.codex/sessions` 39M + `archived_sessions` 3.9M；Codex Connect mapping-store 仅 6 个 Thread。
- 当前项目无任何用量持久化：Thread Usage 仅在 Host 内存；`HostUsage` 无模型名；mapping-store 按规格不存用量。
- 设置页扩展机制：`RendererSettingsPageDefinition` 注册表，Shadow DOM + Tailwind；Renderer 通过 Desktop 的 RequestManager 发送 `codexhost/*` JSON-RPC；新方法须在 shared-contracts 定义常量与 schema、Host 路由、RendererModelClient 与测试（`.atw/spec/renderer-extension/browser/host-rpc.md`）。会话导入页始终使用本地 Host。
- Adapter 可选能力先例：`inspectAccount?()`、`sessionImport?: { listCandidates, resolveCandidate }`。
- TokenTracker 各 Harness 解析要点：
  - Claude Code：`~/.claude/projects/**/*.jsonl`（含 `subagents/`）；读含 `message.usage` 的行；input/cache_read/cache_creation/output；去重键 `message.id + requestId`；增量按 inode + offset；对话数 = 主会话中带文本的用户消息（按 uuid 去重）。
  - Codex：`$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` 与 `archived_sessions/`；`token_count` 事件的累计值差分；input 需扣除 cached；模型取最近 `turn_context`；Fork 会话跳过重放段；对话数 = 每个非零 token_count 事件。
  - Pi：`~/.pi/agent/sessions/**/*.jsonl`（`PI_CODING_AGENT_DIR` 可覆盖）；assistant 消息的 `usage.input/output/cacheRead/cacheWrite/reasoningTokens`；Provider 取消息的 provider；对话数 = 每条 assistant 消息；去重按 entry id。
  - oh-my-pi：`~/.omp/agent/sessions/**/*.jsonl` 及子代理文件；TokenTracker 源码中未能定位其解析定义（导入名存在但定义未找到），**对话数口径待实现时核对**，默认与 Pi 相同。
- TokenTracker 计价：花费 = (input×in + output×out + cached×cache_read + cache_creation×cache_write + reasoning×out) / 1e6；reasoning 已含在 output 内的 Harness（Codex）不重复计；不使用 total_tokens；模型名匹配含别名、去后缀、去厂商前缀、最长子串兜底。
- TokenTracker 口径：「总计」= 最近 24 个月；7 天/30 天为计费总量；平均 = 最近 30 天总量 ÷ 其中有数据的天数；对话数 = 所选范围内对话数之和；每日明细「缓存」列仅缓存读。聚合粒度为 UTC 半小时桶，查询时按时区归日。

## oh-my-pi 核实结论（issue 06，2026-09-26）

- 对话数口径：与 Pi 相同，每条 assistant 消息计 1（含失败/中止、Token 为 0 的回复）。TokenTracker 源码中 `parseOmpIncremental` 的实现仍未找到，但其测试（`test/rollout-parser.test.js` 的 oh-my-pi 段）按每条带 `usage` 的 assistant 消息产生一个事件，与此一致。本机 501 个文件、14,087 条去重 assistant 消息，其中 240 条 Token 为 0。
- 文件格式（omp 二进制内源码与本机数据核对）：第一行是固定宽度、原地改写的标题行（`type:"title"`），会话头在第二行；较早的文件可能没有标题行。子代理会话保存在以父会话文件名命名的目录中（`<会话文件名>/<代理名>.jsonl`，可再嵌套），本机 177 个文件、约占 oh-my-pi Token 的 31%。
- 用量字段：`usage.input/output/cacheRead/cacheWrite/reasoningTokens/totalTokens/cost`。字段名是 `reasoningTokens`（不是 Pi 的 `reasoning`）；本机 9,653 条带该字段的记录全部满足 `totalTokens = input + output + cacheRead + cacheWrite` 且 `reasoningTokens ≤ output`，即推理是输出的子集，按 Pi 同样的方式拆出。TokenTracker 测试把 `reasoningTokens` 另加到总量上，与实际数据不符，未采用。
- 去重：`entry.id + timestamp`，本机 95 条 Fork 复制记录内容一致，无撞键。
- 目录：omp 读取 `PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR`、`PI_CONFIG_DIR`（默认 `.omp`），默认 agent 目录的数据在 `$XDG_DATA_HOME/omp` 存在时改放该处；另有配置档 `OMP_PROFILE`/`PI_PROFILE`（`~/.omp/profiles/<名>/agent`），本次未支持。
- 验证：Adapter 读取本机全部记录的五项 Token 与对话数和独立 Python 求和逐项一致；首次全量约 0.9 s，无新增时增量约 30 ms。
