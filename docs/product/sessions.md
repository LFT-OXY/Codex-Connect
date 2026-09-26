# 会话

「设置 → 会话」列出本机各 Harness 的历史主会话及其用量，并可在 Codex Connect 中恢复。会话与用量来自同一次原生记录读取（见[用量统计](local-usage.md)），数据来源与解析归属见 [ADR-0001](../adr/0001-local-usage-from-native-session-records.md)、[ADR-0002](../adr/0002-native-usage-parsing-lives-in-adapters.md)。当前接入 Claude Code、官方 Codex 与 Pi。

## 页面

- 「会话」页与其他设置页使用同样大小的设置对话框。页面始终查询本地 Host。
- 每行：Harness 图标、标题、项目 · 模型 · 最后活动时间 · 活跃时长 ·（有子代理时）子代理数，以及 Token、费用、轮数、编辑数四列，右侧是「恢复」。Token 以 K/M/B 缩写、悬停可读完整数值；费用格式与用量页相同。
- 标题是 Harness 自己为会话取的名字；没有标题时显示项目名，项目也未知时显示「未命名会话」。页面不显示也不传输消息正文。
- 列表按最后活动时间倒序。从未产生 Token 的会话（例如在模型回复前放弃的会话）不列出。
- 打开页面时 Host 先增量读取新增记录再返回；首次读取全部历史时显示「正在读取会话记录… N / M 个文件」与进度条，每 0.5 秒再查询一次直到得到结果，关闭设置后停止查询。「刷新」按钮强制重新增量读取。
- 某个 Harness 最近一次读取失败时，列表上方为它显示一条提示，其他 Harness 的会话照常列出。本地 Host 不支持会话列表时显示「本地 Host 不支持会话列表」。

## 恢复

- 已映射为 Thread 的会话，「恢复」直接打开该 Thread，不重复导入。
- 未映射的会话先做[会话导入](../architecture/harness-session-import.md)（只登记映射，不复制 Transcript），再打开新 Thread；打开时 Host 以 `resume` 恢复原生会话并继续。
- 同一时刻只恢复一个会话。Harness 不支持导入时「恢复」不可用，悬停说明原因。
- 恢复失败时列表上方显示原因（会话已不在本机、会话正在其他地方运行、Harness 不支持、其他失败）、项目路径与「复制项目路径」，以及再试一次的按钮；映射已建立但 Thread 打开失败时按钮为「重试打开」，重试只打开已映射的 Thread，不再导入。
- 官方 Codex 会话本身就是 Codex Desktop 的 Thread（ID 相同），「恢复」直接打开它，不做导入。Codex Desktop 侧栏默认列出交互来源（终端 CLI 与 Desktop）的 Thread，打开方式是在侧栏中找到该 Thread 并点击；侧栏只加载最近的 Thread（默认 50 个），更早的会话或 `codex exec` 产生的会话可能不在侧栏中，此时显示「侧栏中未找到该 Codex Thread」与重试。
- Claude Code 无法可靠判断会话是否正被其他客户端使用，恢复前应先在终端或其他客户端关闭该会话。

## 口径

- 活跃时长：相邻两条带时间戳的记录间隔不超过 30 分钟的部分之和；更长的间隔视为闲置，不计入。
- 轮数：用户发起的回合数；编辑数：至少调用过一次编辑类工具（`apply_patch`、`Edit`、`Write`、`MultiEdit`、`NotebookEdit`、`str_replace` 等）的回合数。
- 子代理折叠：子代理会话不单独成行，其 Token 与费用计入主会话；轮数、编辑数与活跃时长只统计主会话自身。
- 费用与用量页同价计算：每个会话按其各模型的用量在查询时计价，Harness 自带费用时直接采用。
- Claude Code：标题取最新的 `custom-title`（用户命名），否则取最新的 `ai-title`（Claude 生成），不回退到首条消息；轮数计主会话中不是 `isMeta`、不全是工具结果、有文本且不是中断提示（`[Request interrupted by user…`）或任务通知（`<task-notification>`）的用户消息；模型取最后一条回复的模型（忽略 `<synthetic>`）；`<session>/subagents/*.jsonl` 是该会话的子代理。
- Codex：标题取 `$CODEX_HOME/session_index.jsonl` 中该 Thread 最新的 `thread_name`（重命名后下次读取即更新）；轮数按 `turn_context` 计（同一 `turn_id` 重复出现只算一次），rollout 中没有 `turn_context` 时按用户消息（`user_message`）计；编辑数计调用过 `apply_patch` 等编辑类工具的回合，包括在 `exec` 代码模式脚本中调用的；模型与工作目录取最近一次 `turn_context`。Fork 出的会话（`forked_from_id`）与子代理线程（`parent_thread_id` 或 `source.subagent.thread_spawn.parent_thread_id`）按父子关系折叠进主线程，可多层；父线程不在本机时单独成行。Fork 开头复制的父会话历史也算作 Fork 自身的轮数，但 Fork 折叠后不单独显示。会话归档（移到 `archived_sessions/`）后仍是同一行。
- Pi：标题与会话导入相同，取最新的 `session_info` 名称，未命名时取首条用户消息的文本（折叠空白、截取前 120 个字符）；轮数为用户消息数；编辑数为调用过 `edit`、`write` 等编辑类工具的轮数；模型取最后一条 assistant 消息的模型，工作目录取会话头的 `cwd`。会话头中的 `parentSession` 是子代理的父会话 ID，或 Fork 来源的会话文件路径（取文件名中 `_` 之后的 ID），两者都折叠进父会话。恢复复用 Pi 的会话导入（恢复时校验 Pi 会话文件）。

## 读取与缓存

- 会话摘要与用量记录由同一次读取产出，Host 与用量一起保存在 `usage/local-usage.json` 中：每个原生记录文件一份摘要（不含正文），以及每个会话按 Provider × Model 的用量。原生记录被 Harness 清理后，已读取的会话仍会列出，但无法再恢复。
- 映射状态在每次查询时从本地映射库读取。
