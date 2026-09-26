# 会话用量与恢复

**Status:** implemented

## Problem Statement

用户在 Claude Code、Codex、Pi、oh-my-pi 中积累了大量历史会话，想知道每个会话花了多少 Token 和钱、聊了几轮、改了几次文件，并能挑出某个会话直接在 Codex Desktop 里接着聊。Codex Connect 目前只有一个「会话导入」页：它只列出 Claude Code、Pi、Hermes、DSH 中尚未导入的会话，不显示任何用量，不能按 Harness、时间或项目筛选，oh-my-pi 与官方 Codex 的会话不在其中，也没有办法复制一行命令到终端里继续。用户目前只能借助 TokenTracker 的会话页查看用量，再回到 Codex Connect 手动导入。

## Solution

用新的「会话」标签页替换现有「会话导入」页。页面列出本机 Claude Code、Codex、Pi、oh-my-pi 的所有主会话（子代理会话折叠进主会话），每行显示标题、项目、模型、时间、活跃时长、Token 数、Estimated Cost、轮数、编辑数；可以按 Harness、时间范围、项目筛选，并按标题、项目、模型或 ID 搜索。Hermes、DSH 的可导入会话也在列表中，只是没有用量数字。

每行提供两个动作：

- **恢复**：把该会话作为 Thread 在 Codex Desktop 中打开并继续。已映射的会话直接打开；未映射的先做会话导入再打开；官方 Codex 会话直接打开。
- **复制指令**：复制「进入项目文件夹 + 该 Harness 恢复命令」的一整行，粘进终端即可继续。

同时为 oh-my-pi 补上会话导入能力，使其也能一键恢复。

## User Stories

1. 作为多 Harness 用户，我想在设置的「会话」页看到本机所有 Harness 的历史会话，以便在一个地方浏览。
2. 作为用户，我想让每行显示会话标题，以便认出会话内容。
3. 作为用户，当会话没有标题时，我想看到可识别的替代名称（如项目名），以便仍能区分。
4. 作为用户，我想在每行看到 Harness 图标，以便知道会话来自哪个工具。
5. 作为用户，我想在每行看到项目、模型、最后活动时间与活跃时长，以便了解会话背景。
6. 作为用户，我想在每行看到 Token 数与费用，以便知道哪个会话最耗资源。
7. 作为用户，我想在每行看到轮数与编辑数，以便了解会话的规模和是否改过代码。
8. 作为用户，我想让列表默认按最后活动时间倒序，以便先看到最近的会话。
9. 作为用户，我想按 Harness（全部 / Claude Code / Codex / Pi / oh-my-pi）筛选，以便只看某个工具的会话。
10. 作为用户，我想按时间范围（全部 / 7 天 / 30 天 / 90 天）筛选，以便聚焦近期会话。
11. 作为用户，我想按项目筛选，以便只看某个项目的会话。
12. 作为用户，我想按标题、项目、模型或会话 ID 搜索，以便快速定位会话。
13. 作为用户，我想让子代理会话折叠进其主会话，并把子代理的用量计入主会话，以便列表不被子代理刷屏且总量正确。
14. 作为用户，我想看到「N 个主线程 · M 个子代理已折叠」的汇总，以便知道列表的构成。
15. 作为用户，我想点击「恢复」让会话在 Codex Desktop 中以 Thread 打开并可继续对话，以便在 Codex 中接着工作。
16. 作为用户，当会话已经在 Codex Connect 中存在时，我想点击「恢复」直接跳到那个 Thread，以便不产生重复 Thread。
17. 作为 oh-my-pi 用户，我想让 oh-my-pi 会话也能一键恢复到 Codex，以便与其他 Harness 一致。
18. 作为 Codex 用户，我想点击 Codex 会话的「恢复」在 Codex Desktop 中打开它，以便继续原生会话。
19. 作为用户，当恢复失败时，我想看到清楚的失败原因以及「重试打开」「复制项目路径」，以便自行处理。
20. 作为用户，当会话正在其他地方运行时，我想看到提示，以便避免同时从两处继续同一会话。
21. 作为终端用户，我想点击「复制指令」得到「进入项目文件夹 + 恢复命令」的一整行，以便粘进终端直接继续。
22. 作为 Windows 用户，我想让复制的指令适用于我的系统终端，以便直接粘贴执行。
23. 作为用户，当项目路径包含空格或特殊字符时，我想让复制的指令依然能正确执行，以便不必手动修改。
24. 作为用户，我想在复制成功后看到简短反馈，以便确认已复制。
25. 作为 Hermes / DSH 用户，我想在同一列表中看到可导入的 Hermes、DSH 会话并能恢复，以便不因旧页面被替换而失去该功能。
26. 作为 Hermes / DSH 用户，我想让这些会话的用量栏显示为空而不是 0，以便不被误导。
27. 作为用户，我想点击刷新按钮重新读取会话与用量，以便看到最新的会话。
28. 作为首次打开的用户，我想在读取全部历史时看到进度，以便知道需要等待。
29. 作为会话很多的用户，我想让列表滚动流畅，以便浏览数千个会话。
30. 作为用户，我想让某个 Harness 读取失败时其他 Harness 的会话仍能显示，并看到该 Harness 的失败提示，以便局部问题不影响整体。
31. ~~作为用户，我想让设置对话框在「会话」页放大到接近整个窗口，以便列表不拥挤。~~（沿用 2026-09-26 用量页取消放大的决定：放大会盖住 macOS 红绿灯，且与其他设置页不一致；会话页与其他设置页同尺寸。）
32. 作为深色/浅色主题用户，我想让页面在两种主题下都清晰，以便任何主题下都可读。
33. 作为中文或英文界面用户，我想让所有文案都有对应语言版本，以便界面语言一致。
34. 作为隐私敏感用户，我想让列表只展示标题与统计，不向页面传输对话正文，以便保护隐私。

## Implementation Decisions

- **页面替换**：新「会话」设置页取代现有「会话导入」设置页（页面 ID、标签、图标相应调整），原页的导入、打开、失败重试与复制项目路径能力并入新页。设置对话框与其他设置页同尺寸（「本地用量仪表盘」任务已取消按页放大）。该页始终使用本地 Host。
- **会话事实来源**：扩展「本地用量仪表盘」任务定义的原生用量读取能力，使其在用量记录之外同时产出会话摘要：Native Session ID、可选父会话 ID（子代理/子线程）、标题、工作目录、最后使用的模型、首末活动时间、活跃时长（相邻记录间隔 ≤30 分钟的累计）、轮数、编辑数。摘要不含对话正文。各 Harness 口径：
  - Claude Code 与 Codex 沿用 TokenTracker 的标题、轮数、编辑数、子代理识别口径；
  - Pi 与 oh-my-pi：标题复用现有会话导入的标题提取（摘要中截到 120 字）；轮数为用户消息数；编辑数为包含编辑类工具调用的轮数；子代理按其原生父子关系识别（Pi 会话头 `parentSession` 为会话 ID；oh-my-pi 按所在文件夹）。Fork（`parentSession` 为会话文件路径）是独立会话，单独成行、可单独恢复（2026-09-26 用户决定）。
  - 哪些工具算编辑、恢复命令（`nativeUsage.resumeCommand`）都由各 Adapter 提供（官方 Codex 由 Codex 运行时提供），公共契约与 Renderer 不写 Harness 专属内容（2026-09-26 用户决定，替代原「Renderer 生成恢复命令」）。
  - Claude Code 主会话的 Native Session ID 取文件名（与会话导入一致）；标题取 `custom-title`（用户命名），否则 `ai-title`。
- **Host 会话服务**：与 Host 用量服务共享读取、游标与持久化；把会话摘要与用量记录按 Native Session 关联得到每会话的 Token 数与费用（计价规则与仪表盘一致）；按父子关系折叠子代理并把其用量计入主会话；结合 mapping-store 标注每个会话是否已映射为 Thread 及其 Thread ID；把没有原生用量读取、但支持会话导入的 Harness（Hermes、DSH）的 `sessionImport` 候选并入列表（无用量字段；每个 Harness 列举最多等 5 秒，失败按来源提示）。从未产生 Token 的会话不列出，与 TokenTracker 一致（2026-09-26 用户确认；旧页能导入的这类会话在新页不再出现）。与用量共用状态文件（升到 v3）；v2 状态迁移时保留已统计的用量桶，只重新读取原生记录补建会话（2026-09-26 用户决定）。
- **RPC 契约**（shared-contracts）：
  - 会话列表查询：参数为是否强制刷新；结果为全部主会话行（Harness、Native Session ID、标题、项目、模型、时间、时长、Token、费用、轮数、编辑数、子代理数、是否已映射、是否可恢复、是否运行中、复制指令所需的工作目录与 Adapter 提供并经 Host 校验的恢复命令）以及读取进度与各来源状态。筛选、搜索、排序在 Renderer 本地完成。
  - 恢复动作：已映射 → 返回 Thread ID 供 Renderer 打开；未映射且 Harness 支持会话导入 → 复用现有会话导入请求完成映射后打开；官方 Codex → 在 Codex Desktop 中打开对应 Thread（已核实：Desktop 侧栏默认列出 CLI 与 Desktop 来源的 Thread；打开方式是在侧栏中找到并点击，侧栏只加载最近的 Thread，更早的会话打开失败时提示在侧栏中查找或重试）。
- **oh-my-pi 会话导入**：oh-my-pi Adapter 实现 `sessionImport`（列举候选与只读重新校验），行为与 Pi 的实现对齐；恢复沿用其已有的按 Native Session 打开能力。
- **复制指令**：恢复命令由 Adapter 提供（`claude --resume <id>`、`codex resume <id>`、`pi --session <id>`、`omp --resume <id>`），Host 只为安全字符集内的会话 ID、且不含 shell 语法的命令放进会话行；Renderer 按平台加上进入工作目录的部分：macOS/Linux 为 `cd -- '<工作目录>' && <命令>`，Windows 为 `Set-Location -LiteralPath '<工作目录>'; if ($?) { <命令> }`，工作目录按对应 shell 规则转义。没有恢复命令的 Harness（Hermes、DSH）不提供复制指令。
- **Renderer 页面**：原生 DOM + Tailwind；列表需支持数千行的流畅滚动（按需渲染或分批渲染）；筛选状态仅存在于当前页面。
- **文档**：更新 `docs/architecture/harness-session-import.md`（新增 oh-my-pi、页面替换、恢复入口）及 `docs/index.md` 描述。

## Testing Decisions

- 好的测试只检验外部行为：给定一组原生记录与映射状态，会话列表请求返回的行、折叠与数字是否正确，恢复动作是否得到可打开的 Thread；不检验内部缓存结构。
- **主切入点：Host 会话列表与恢复请求**。临时目录放置四个 Harness 的伪造会话记录（含子代理/子线程、已映射与未映射会话），用真实 Adapter 通过请求层断言：行字段、子代理折叠与用量归并、已映射标注、Hermes/DSH 候选并入、恢复已映射会话返回既有 Thread、恢复未映射会话产生映射且不复制正文、单来源失败隔离。先例：`packages/host-runtime/test/harness-session-import.test.ts`。
- **Adapter 切入点**：各 Harness 会话摘要口径（标题、轮数、编辑数、活跃时长、父子识别）；oh-my-pi 会话导入的候选列举与重新校验。先例：`packages/adapters/pi/test/pi-session-import.test.ts`、`packages/adapters/claude-code/test/claude-session-import.test.ts`。
- **复制指令**：纯函数测试，覆盖各 Harness 命令、POSIX 与 PowerShell 转义、含空格/引号/非 ASCII 的路径、非法会话 ID。
- **渲染与筛选**：用假 DOM 检验行结构、筛选/搜索/时间范围、折叠汇总文案、Hermes/DSH 行的空用量呈现（先例 `packages/renderer-extension/test/settings/accounts-usage.test.ts`）。
- **人工验证**：四个 Harness 各恢复一个会话并能继续对话；复制的指令在终端中可直接执行；截图对照参考图。

## Out of Scope

- Claude Code、Codex、Pi、oh-my-pi 以外 Harness 的会话用量（Hermes、DSH 仅保留可恢复，不统计用量）。
- 在 Harness 自己的 CLI 或其他应用中自动打开会话（只提供复制指令）。
- 会话正文预览、删除、重命名、归档、导出。
- 远程/SSH Host 上的会话。
- 按会话的费用预警或排行图表。

## Further Notes

- 依赖「本地用量仪表盘」任务的原生用量读取能力、Host 用量服务、计价与设置对话框放大能力，须在其之后实施。
- 已核实（2026-09-26）：Codex CLI 会话出现在 Desktop 侧栏（见工单 02）；Claude Code、Pi、oh-my-pi 的恢复命令以不存在的 ID 实际运行确认参数被识别，Codex 按 `codex resume --help` 确认（见工单 06）。
- 可执行契约见 `.atw/spec/host-runtime/node/local-sessions.md`，产品行为见 `docs/product/sessions.md`。
- 参考实现：TokenTracker（MIT）。按用户要求只参照思路自行实现，不复制代码，不带原作者署名。
- 讨论过程见 `research/discussion-decisions.md`。
