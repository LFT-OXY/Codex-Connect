# 讨论结论：会话用量与恢复

来源：2026-09-25～26 与用户的需求访谈（atw-askme-with-docs）。参考对象为 TokenTracker（MIT）的「会话」页截图与源码。

## 用户已决定

- Q9 恢复语义：「恢复会话」= 会话导入 + 在 Codex Desktop 中打开并继续，不是在 Harness 自己的 CLI 中打开；另外提供「复制指令」选项。术语见术语表 Session Import。
- Q10 列表与筛选全部照截图：每行标题、项目、模型、时间、时长、Token 数、费用、轮数、编辑数；按 Harness、时间范围（全部/7/30/90 天）、项目筛选，搜索标题/项目/模型/ID；子代理会话折叠进主会话。
- Q17 新「会话」页替换现有「会话导入」页；Hermes、DSH 会话也列在其中，只是没有用量数字。
- Q18 为 oh-my-pi 补上会话导入能力。
- Q19 复制指令内容 = 进入项目文件夹 + 恢复命令的一整行。
- Q20 入口只有现有设置按钮。
- 覆盖 Harness、费用、对话数、项目识别等口径与「本地用量仪表盘」任务一致。

## Agent 替用户定的小事（用户已在总结中确认）

- 已经映射为 Thread 的会话，点「恢复」直接打开该 Thread，不重复导入。
- 官方 Codex 会话点「恢复」即在 Codex Desktop 中打开。**前提未核实**：Codex CLI 产生的会话是否本来就出现在 Codex Desktop 侧栏；实现前先确认，若不是则回到用户决定。
- 打开「会话」页时设置对话框放大。

## 调研事实

- 现有会话导入：Claude Code、Pi、Hermes、DSH 实现了 `sessionImport`（`listCandidates` / `resolveCandidate`）；导入只写 mapping 记录，不复制 Transcript；导入后 Renderer 在侧栏定位对应 Thread 并打开；Host 打开时以 `resume` 方式恢复 Native Session。已映射的会话会从候选中过滤。现有页支持搜索、分页，打开失败时提供「复制项目路径」「重试打开」。文档：`docs/architecture/harness-session-import.md`。
- oh-my-pi Adapter 已支持以 `resume` + nativeRef 打开已有 Native Session，缺的是候选列举与重新校验。
- 恢复命令（取自各 CLI `--help`，未实际执行）：`claude --resume <id>`、`codex resume <id>`、`pi --session <id>`、`omp --resume <id>`。须在会话的工作目录执行。
- TokenTracker 会话口径：
  - 标题：Claude 用 `ai-title` 记录；Codex 用 `session_index.jsonl` 的 `thread_name`；无标题时界面显示项目名。TokenTracker 不覆盖 Pi / oh-my-pi 会话，其标题、轮数口径需自定（可复用现有 Pi 会话导入的标题提取）。
  - 轮数：Claude 为非 meta、非纯 tool_result、非中断提示/任务通知的用户消息数；Codex 为 `turn_context` 个数（无则 user_message 数）。
  - 编辑数：包含至少一次编辑类工具调用（apply_patch/edit/write/multiedit/notebookedit/str_replace 等）的轮数。
  - 时长：只累加相邻记录间隔 ≤30 分钟的部分（活跃时长）。
  - 子代理：Claude `subagents/*.jsonl` 与父会话同 sessionId，合并为一行；Codex 子线程按 `forked_from_id` / `parent_thread_id` 建树折叠；页面显示「N 个主线程 · M 个子代理已折叠」。
