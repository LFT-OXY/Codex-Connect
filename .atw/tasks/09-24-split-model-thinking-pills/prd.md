# 拆分模型与思考选项药丸

**Status:** ready-for-agent

决策来源：`research/discover-decisions.md`（Q1–Q19，用户已确认）。术语遵循 `docs/project/领域术语表.md`，尤其是 **Thinking Option / 思考选项**。

## Problem Statement

在外部 Harness 的 Thread 里，输入框下方只有一个药丸，Model 和 Thinking Option 挤在一起。用户要先点开药丸，看到上半部分的思考选项列表，再把鼠标移到"Model ›"上展开二级菜单才能换模型。两件事混在一个入口里：想换模型得先经过思考选项，想调思考强度得先打开一个同时装着模型入口的菜单。药丸上的文字也是"模型名 + 思考 label"连在一起，在窄窗口里很快被截断，用户看不清当前用的是哪个 Model、哪个思考选项。

另外，思考选项目前只是一列纯文字，看不出"当前在强度序列里的哪个位置"。

## Solution

把原来的一个药丸拆成两个相邻的独立药丸：`[模型药丸][思考药丸]`。

- **模型药丸**：显示当前 Model 名称，点开直接进入现有的模型列表（搜索、收藏都保留），不再有中间层菜单。
- **思考药丸**：只显示当前思考选项的 label。点开后在药丸上方弹出一张卡片，卡片上是大号的当前选项名、小号的 Model 名，以及一条分段滑块。滑块的每个点对应 Harness 提供的一个思考选项，按 Harness 给出的顺序排列。填充长度、颜色（从蓝渐变到紫）和填充段里的星点纹理都随所选位置变化，一眼就能看出"强度大概在哪"。

当前 Harness 或 Model 没有可选的思考选项时，思考药丸整个隐藏。原生 Codex Thread 不受影响。

## User Stories

1. 作为外部 Harness Thread 的用户，我想在输入框下方看到一个只写着 Model 名称的药丸，以便一眼确认当前用的是哪个 Model。
2. 作为外部 Harness Thread 的用户，我想在 Model 药丸右边看到一个独立的思考药丸，以便一眼确认当前的思考选项。
3. 作为用户，我想点 Model 药丸时直接看到模型列表，以便不经过任何中间菜单就能换 Model。
4. 作为用户，我想在模型列表里继续使用搜索框，以便在 Model 很多时快速找到目标。
5. 作为用户，我想在模型列表里继续收藏 Model，并让收藏的排在前面，以便快速选中常用的 Model。
6. 作为用户，当 Harness 解析出的实际模型名和我选的 Model 名不同时，我想在 Model 药丸上以次要文字看到解析后的名字，以便知道真正在用哪个模型。
7. 作为用户，我想点思考药丸时在药丸上方看到一张思考卡片，以便单独调整思考选项。
8. 作为用户，我想在卡片上看到大字的当前思考选项名，以便明确知道当前选中的是什么。
9. 作为用户，我想在卡片上看到小字的当前 Model 名，以便知道这组思考选项属于哪个 Model。
10. 作为用户，我想在卡片上看到一条分段滑块，每个点对应一个思考选项，以便直观看到可选的范围和当前位置。
11. 作为用户，我想拖动滑块的拖块来切换思考选项，以便像调节强度一样操作。
12. 作为用户，我想点击滑块上的任一点直接跳到对应选项，以便不用拖动也能快速选择。
13. 作为键盘用户，我想在滑块获得焦点后用 ←/→ 调整选项，以便不用鼠标也能完成选择。
14. 作为用户，我想在拖动过程中看到卡片上的大字实时变成拖块所在的选项名，以便松手前知道会选中什么。
15. 作为用户，我想只在松手或点击时才真正提交选择，以便拖动经过的中间选项不会被逐个发送给 Harness。
16. 作为用户，我想提交后卡片依然保持打开，以便看到结果或继续调整。
17. 作为用户，我想点击卡片外部或按 Esc 关闭卡片，以便回到输入。
18. 作为用户，我想看到填充长度随所选位置变长，以便感知强度高低。
19. 作为用户，我想看到填充颜色随位置从蓝渐变到紫，以便更强烈地感知强度差异。
20. 作为用户，我想看到填充段里的星点纹理随位置变得更密更亮，以便获得"更强"的直观反馈。
21. 作为用户，我想看到星点有轻微的慢速闪烁，以便卡片看起来更生动。
22. 作为开启了"减少动态效果"系统设置的用户，我想让星点保持静态，以便不受动画干扰。
23. 作为用户，当我选中处在第一位的选项（例如 Claude Code 的 `Off`）时，我想看到填充为空、没有星点，以便明白"没有强度"。
24. 作为 Claude Code 用户，我想在滑块上看到 Claude Code 提供的全部思考选项（`Off, Auto, Low, Medium, High, Extra High, Max`），按 Harness 的顺序排列，以便使用 Harness 的全部真实能力。
25. 作为 Antigravity 用户，我想在滑块上只看到 `Low/Medium/High` 三个点，以便点的数量与 Harness 实际能力一致。
26. 作为用户，我想看到 Harness 原文的选项名（例如 `High`），以便与 Harness 自身的文档和行为对应。
27. 作为用户，当 Model 没有思考选项、只支持 `off`，或 Harness 不支持选择思考选项时，我想完全看不到思考药丸，以便不被无效控件干扰。
28. 作为用户，当 Model 只支持一个非 `off` 的思考选项时，我想仍然看到思考药丸并能打开卡片查看，但滑块只读，以便知道当前的强度但不会误以为可以调整。
29. 作为用户，我想在切换 Model 后看到思考药丸显示 Harness 确认的新思考选项，以便在原选项不被新 Model 支持时知道实际生效的是哪个。
30. 作为用户，我想在切换 Model 后思考卡片不会自动弹出，以便两个药丸各自独立，不打断我。
31. 作为用户，我想在选择正在提交时（Model 或思考选项）两个药丸都暂时不能点，以便不会发起冲突的切换。
32. 作为用户，当选择正在提交时卡片若已打开，我想卡片保持打开、滑块暂时禁用、完成后恢复，以便不会因为一次提交就被关掉卡片。
33. 作为在窄窗口或收窄侧边栏下使用的用户，我想让 Model 药丸先截断显示省略号、思考药丸保持完整，以便短小的思考 label 始终可见。
34. 作为用户，我想让思考卡片靠近屏幕边缘时自动收回可视范围，以便卡片不会被裁掉。
35. 作为暗色主题用户，我想让卡片和渐变色在暗色下同样协调，以便不出现刺眼的白色卡片。
36. 作为读屏软件用户，我想让滑块被识别为滑块，并读出当前选项名，以便知道当前的思考选项。
37. 作为中文界面用户，我想让新增的无障碍标签等 Host 文案有中文版本，以便与界面语言一致。
38. 作为原生 Codex Thread 用户，我想让官方的模型选择器保持原样，以便官方体验不受影响。
39. 作为用户，在模型列表加载中、无模型或加载失败时，我想让 Model 药丸继续显示现有的状态文字（加载中、无模型、不可用），以便知道原因。
40. 作为用户，在切换到另一个 Harness 时，我想让已打开的卡片或模型列表自动关闭并按新 Harness 重建，以便不会看到上一个 Harness 的选项。

## Implementation Decisions

- **范围**：只改 renderer-extension 包里注入的外部 Harness 控件。不改 `shared-contracts` 合约，不改任何 Adapter，也不改 Host 的 RPC。思考选项的选择仍然走现有的 thinking select RPC，模型选择仍然走现有的 model select RPC。
- **模块划分**：
  - 现有的合并选择器模块改为**只负责 Model**：只保留"药丸 + 独立模型列表"一条路径，删除"主菜单 + Thinking 分组 + Model › 子菜单"，以及只为这些东西服务的定位函数和状态。药丸上仍然显示 `resolvedModelLabel` 次要文字。
  - 新增一个**思考选项选择器模块**，负责思考药丸、卡片、滑块及其注入样式表。原模块已经接近 800 行，按项目的规模约定，新职责放进独立模块。
  - Composer 挂载逻辑同时挂载两个控件，紧挨着把思考药丸放在 Model 药丸右边。`onSelectThinking` 回调改为接到新模块上，接线方式和现有的权限模式选择器一致。
- **思考选项的展示接口（纯函数，是本次的主要测试接缝）**：输入是现有的 Model 控件视图（catalog、selected、selectedThinkingOptionId、thinkingSelectionSupported、status），输出一个与 DOM 无关的展示结果，至少包括：
  - 是否显示思考药丸：沿用现有 `showThinkingSection` 的判断——有选项，且不是"只有 `off`"，且 `thinkingSelectionSupported !== false`；
  - 药丸 label（当前选项的 Harness 原文 label）；
  - 有序的选项列表，以及当前选中项的下标；
  - 是否只读：可选项少于 2 个；
  - 是否禁用：沿用现有的加载中、选择中等状态判断；
  - 卡片副标题（当前 Model 的 label）；
  - 滑块视觉参数：相对位置 `t = index / (n-1)`（只有一个选项时约定 `t = 0`）、填充比例、按 `t` 插值得到的颜色、星点密度与亮度（`t = 0` 时没有星点）。
  用于测试"哪些选项可见"的现有函数（按 Model 的 `supportedThinkingOptionIds` 过滤 catalog）直接复用，不另写一份。
- **滑块交互**：
  - 拖动时只更新卡片上的预览 label 和视觉效果，不提交；
  - `pointerup` 或点击某个点时，按落点吸附到最近的选项；只有和当前选中项不同时，才调用一次 `onSelectThinking`；
  - ←/→ 每按一次移动一格并提交；
  - 提交后卡片不关闭。点击外部或按 Esc 关闭，关闭方式沿用现有的手动 popover 关闭写法（document 捕获阶段的 pointerdown/keydown）。
- **状态与刷新**：`selecting` 期间两个药丸都禁用。卡片如果开着就保持打开，只禁用滑块。在过渡状态下不重建卡片内容，沿用现有 `keepOpenMenu` 的语义。切换 Harness 时关闭并重置两个控件。切换 Model 后，思考选项显示什么完全以 Harness 返回的选择状态为准，renderer 不自己做回退。
- **卡片定位与外观**：
  - 卡片宽约 240–260px，锚定在思考药丸上方、左边对齐，超出视口时收回，写法沿用现有定位模块（纯函数计算位置）；
  - 卡片和现有模型列表一样，挂到 document 顶层的 popover 上；
  - 卡片的背景和圆角与现有模型列表保持一致；
  - 卡片上没有闪电图标、重置按钮和 `>`。
- **颜色与主题**：
  - 渐变的颜色节点是本项目自己定义的常量：亮色、暗色各一套，起点是接近 Codex 强调色的蓝，终点是紫；
  - 颜色写在新模块自己的 `data-codexhost-*` 样式表里，**不读取、不复制 Desktop 的私有设计 token**（遵守 renderer-extension 样式规范）。这是对访谈中"用 Codex 的强调蓝"的具体落地：视觉上接近，但不依赖官方 token；
  - 判断亮色还是暗色主题，沿用本包注入控件现有的做法。
- **星点动画**：只在填充段内用 CSS 实现慢速、轻微的闪烁；在 `prefers-reduced-motion: reduce` 下关闭动画。
- **窄窗压缩**：Model 药丸继续使用现有的最大宽度和压缩逻辑；思考药丸设为不压缩（`flex: none`）。
- **文案与无障碍**：
  - 选项 label 显示 Harness 原文，不翻译；
  - 新增的 Host 自己的文案（思考药丸和滑块的无障碍名称等）在 Composer 控件的本地化表里同时提供 `en` 和 `zh-CN`，不在组件里写死；
  - 滑块使用 `role="slider"`，带 `aria-valuemin`、`aria-valuemax`、`aria-valuenow`，并把 `aria-valuetext` 设为当前选项 label；只读时设置 `aria-readonly`。

## Testing Decisions

- **好测试的标准**：只断言外部可观察的行为，即"给定视图 → 展示结果"或"给定位置 → 定位与视觉参数"，不断言内部的 DOM 结构或私有状态。视觉效果（颜色是否好看、星点效果）不在 vitest 里断言。
- **接缝**：
  1. 思考选项展示纯函数（新模块导出），这是主要接缝；
  2. 卡片定位纯函数，放在现有定位模块中，属于已有的接缝。
  Model 药丸继续用现有的 `rendererModelPickerPresentation`，并删掉其中与 Thinking 相关的断言。
- **覆盖情形**：
  - 按 Q18 覆盖 1 个、2 个、7 个（Claude Code 的完整序列）以及"只有 `off`"这几种选项数量；
  - `thinkingSelectionSupported === false`；
  - Model 没有声明 `supportedThinkingOptionIds`（不能拿全局选项顶替）；
  - 加载中、选择中时的禁用；
  - `t` 的端点值（第 0 位没有填充、没有星点，最后一位填满）以及颜色插值的端点；
  - 卡片在视口边缘时的定位回收。
- **可参考的现有写法**：现有 model picker 测试里的 `catalog(levels)` 构造器，以及对 presentation 和 placement 纯函数的断言方式；`rendererAgentPickerView` 和 `rendererAgentMenuPlacement` 的视图函数测试。测试运行在 Node 环境，用 schema 构造品牌 ID。
- **构建与人工验收**：
  - 运行 `npm run build:renderer`，确认 browser bundle 能打包成功；
  - 运行 `npm run lint`，完成边界检查；
  - 视觉和交互由用户运行 `npm start`，在真实 Desktop 中目测：亮色和暗色主题、窄窗口、Claude Code 的 7 档、只有一个选项的只读情形。

## Out of Scope

- 原生 Codex Thread 的官方模型或思考选择器。
- 修改 `HarnessThinkingOption` 合约，例如给 `Off`/`Auto` 加上"非档位"标记，或做成独立开关。
- 由 Adapter 按语言提供本地化 label，或者由 renderer 按 id 翻译选项名。
- 选完 Model 后自动引导去选思考选项。
- 卡片上的重置按钮、闪电图标、`>` 二级入口。
- 为视觉效果补写 Playwright e2e。
- 修改 Model 列表本身的搜索、收藏行为。

## Further Notes

- 滑块按 Harness 给的顺序铺开所有选项，所以 `Auto` 会显示在 `Off` 和 `Low` 之间。这是有意接受的取舍：renderer 不去猜 Harness 的语义，顺序由 Adapter 负责。
- 项目规范要求注入控件不复用 Desktop 的私有 token，因此"主题强调蓝"落地为本项目自己定义的近似色常量。如果以后 Desktop 暴露了公开的主题变量，可以再评估是否改用。
- 不写 ADR：这些决定可逆，而且不需要额外背景就能看懂。

## Implementation Notes

实现后回写的落地细节，其中两项是规格原文没有覆盖、在实现中确定的：

- **模块**：`renderer-thinking-option-picker.ts`（药丸、卡片、滑块、展示纯函数）和 `renderer-thinking-option-style.ts`（`data-codexhost-thinking-option-style` 样式表）。`renderer-model-picker.ts` 只保留 Model 药丸和模型列表，并导出 `MENU_CLASSES` 供卡片复用。卡片定位函数 `rendererThinkingCardPlacement` 放在 `renderer-model-picker-positioning.ts`，宽 248px。主菜单和子菜单的定位函数已删除。
- **卡片外观（已确认的例外）**：卡片与模型列表共用 `MENU_CLASSES`，因此仍然使用 Desktop 的 Tailwind token 类。这和 `styling.md` 的"不复用私有 class"要求冲突，经用户确认，为保持外观一致而保留。滑块配色完全在自有样式表中定义。
- **选项尚未确认时（规格未覆盖）**：思考药丸仍按显隐规则显示，文字回退为 Host 文案 `thinkingOption`（`Thinking` / `思考`）。此时 `selectedIndex = -1`，滑块不设置 `aria-valuenow` 和 `aria-valuetext`。
- **视觉参数**：`position = index / (n-1)`，同时作为填充比例。颜色在 `RENDERER_THINKING_GRADIENT` 的亮色和暗色两组端点之间插值，以 `light-dark()` 输出。星点数为 `round(position² × 16)`，第 0 位为 0，其他位置至少为 1。填充长度与 position 成正比，星点数按平方增长，因此单位长度上的密度随位置变大。星点亮度为 `0.4 + 0.6 × position`。
- **提交期间的显示**：提交后，滑块在 `selecting` 期间停在已提交的位置；Harness 返回结果后，以其选择状态为准。
- **键盘与焦点**：打开卡片时焦点移到滑块。←/→ 会阻止事件继续传播，避免 Harness 的全局键盘处理把焦点拉回输入框。
- **测试**：单测见 `test/renderer-thinking-option-picker.test.ts`。另外补了只断言交互、不断言视觉的 e2e：`tests/e2e/renderer-thinking-option-picker.spec.ts`。`renderer-model-picker.spec.ts` 和 `renderer-binding-startup.spec.ts` 中的 Kiro 用例已改为适配两个独立药丸。

## 验收反馈修订（2026-09-24）

用户在真实 Desktop 中目测后，本任务退回实现阶段。参考图为 `research/thinking-card-reference.png`（522×216，按 2 倍图理解，下文尺寸均为 1 倍 CSS 像素）。

### 修订 1：滑块改为参考图样式

- **轨道**：改为约 24px 高的胶囊，两端全圆角，未填充部分为浅灰（暗色主题下用对应的暗灰）。当前实现是 10px 细条，用户认为太细。
- **填充**：与轨道等高，左端圆角；右端延伸到拖块中心，被拖块盖住。颜色、蓝到紫的渐变和星点规则不变。星点要在较粗的填充段里清楚可见。
- **拖块**：约 28px 的白色圆形，比轨道略大，带柔和阴影，圆心落在当前位置，压在轨道上。去掉当前那种彩色描边的小圆环样式。
- **未到达的点**：落在未填充轨道上的点显示为灰色小圆点；已到达的点被填充覆盖，可以不显示。
- **动画**，这是用户指出的主要问题：
  - 拖动时，拖块和填充跟随指针**连续移动**，不再逐格跳。卡片上的大字仍然实时显示最近的选项。
  - 松手或点击时，拖块和填充以约 200ms 的 ease-out 动画吸附到最近的点，然后按原规则只提交一次。
  - ←/→ 与 Harness 确认后的位置变化也走同样的过渡动画。
  - 在 `prefers-reduced-motion: reduce` 下关闭过渡与星点闪烁，瞬时到位。
- **卡片排版**：大号选项名和小号 Model 名改为**居中**。
- **仍然不做**：闪电图标、重置按钮和 `>`，保持 Q7 的决定。
- **展示接口**：新增一个纯函数，根据指针的连续位置算出显示用的连续 `position` 和最近选项的下标，作为测试接缝。它与 `rendererThinkingSliderIndexAt` 保持一致：取整后得到的下标相同。

### 修订 2：模型列表加宽

- 模型列表的首选宽度由 280px 改为 **360px**，仍然贴着药丸右边缘对齐，并在视口内收回：窄窗口时收窄到 `视口宽度 - 16px`。
- 用户没有指定固定宽度还是自适应，本次按固定 360px 加视口收回实现。

### 不在本次修订范围

- Pi 等 Adapter 按模型提供实际思考等级（验收反馈第 1 点）：用户决定暂不处理。原因是 Pi Adapter 给所有推理模型都声明了全部 7 档（`packages/adapters/pi/src/pi-model-catalog.ts`），属于 Adapter 范围，以后如需处理再另开任务。

### 修订实现记录

- **结构**：`[data-codexhost-thinking-rail]`（24px 胶囊）内有两层。第一层是填充 `[data-codexhost-thinking-fill]`。第二层是左右各内缩 `RAIL_INSET = 12px` 的 `[data-codexhost-thinking-track]`，选项点和 28px 拖块都按百分比定位在 track 内，所以首尾位置的拖块也完整落在轨道上。填充宽度为 `12px + (100% - 24px) × position`，右端正好在拖块圆心；第 0 位时宽度为 0，满足"第 0 位没有填充"。
- **纯函数**：`rendererThinkingSliderPointerAt(clientX, track, count) → { position, index }` **替换**了原 `rendererThinkingSliderIndexAt`，旧函数已删除。它按 track 区间（不含两端内缩）计算连续位置，`index = round(position × (n-1))`，与旧函数对同一输入给出相同下标。展示时，连续位置通过内部的 `sliderVisualAt(position)` 算颜色和星点，`rendererThinkingSliderVisual(index, count)` 也基于它实现。
- **控件状态**：新增 `dragPosition`。拖动中它等于指针的连续位置，拖块和填充跟随它；其余时间为 null，拖块停在 `displayIndex` 或已选项对应的点上。大字始终显示 `displayIndex` 对应的最近选项。
- **动画**：填充 `width`、拖块 `left`、未到达点的 `opacity` 都使用 `0.2s ease-out`。按下时只把 `displayIndex` 吸附到最近的点，保留过渡，所以点击也有动画。开始移动后才用 `data-dragging="moving"` 关闭这三项过渡，改为连续跟随。星点数随连续位置变化时只增删差额，已有星点的闪烁不会重来。
- **参考图细节**：大号选项名使用当前位置的渐变色，和参考图的蓝色标题一致；这个颜色也写入 `--codexhost-thinking-accent`，供焦点描边使用。每第 3 颗星点为 3px，其余为 2px，保证在较粗的填充上看得清。星点横向只分布在填充中不被拖块盖住的部分，即 `(填充宽度 - 14px 拖块半径)` 的 4%–96%。已到达的点隐藏（`data-reached="true"`）。
- **测试**：`test/renderer-thinking-option-picker.test.ts` 覆盖连续位置、越界与退化 track，以及吸附下标与最近点位一致。e2e 新增两个用例：一个验证连续跟随、按下时保留过渡、移动后关闭过渡、松手吸附；另一个验证减少动态效果时过渡为 `0s`。尺寸等纯视觉效果不做 e2e 断言。模型列表宽度 360 的断言见 `test/renderer-model-picker.test.ts`。

## Acceptance Criteria

- [ ] 在外部 Harness Thread 中，输入框下方出现两个相邻药丸：`[Model][思考选项]`；原生 Codex Thread 不变。
- [ ] Model 药丸点开后直接出现模型列表，搜索和收藏可用，不再有"Model ›"中间层。
- [ ] `resolvedModelLabel` 与 Model 名不同时，作为次要文字显示在 Model 药丸上。
- [ ] 思考药丸只显示当前选项的 Harness 原文 label（选项尚未确认时回退为 Host 文案，见 Implementation Notes）。没有选项、只有 `off` 或不支持选择时隐藏；只有一个选项时显示，卡片可打开，滑块只读。
- [ ] 思考卡片只包含大号的当前选项名、小号的 Model 名和滑块，没有闪电、重置和 `>`。
- [ ] 滑块的点数与顺序与当前 Model 支持的 Harness 思考选项一致。
- [ ] 拖动时只更新预览；松手或点击才提交，而且每次只提交一次；←/→ 每按一次调整一格并提交；提交后卡片保持打开；点击外部或按 Esc 关闭。
- [ ] 填充长度、颜色（蓝到紫）、星点密度和亮度随相对位置变化；第 0 位没有填充、没有星点；`prefers-reduced-motion` 下星点静态。
- [ ] `selecting` 期间两个药丸禁用；已打开的卡片保持打开，滑块暂时禁用，完成后恢复。
- [ ] 切换 Model 后，思考药丸显示 Harness 返回的选项，卡片不自动弹出；切换 Harness 时已打开的菜单或卡片关闭。
- [ ] 窄窗口下 Model 药丸截断显示省略号，思考药丸保持完整；卡片靠近视口边缘时收回可视范围。
- [ ] 亮色和暗色主题下卡片与渐变都协调；新样式不引用 Desktop 私有 token。
- [ ] 滑块具备 `role="slider"` 及 value 和 valuetext 属性；新增的 Host 文案同时有 `en` 和 `zh-CN`。
- [ ] 新增和调整后的 vitest 覆盖上述展示与定位情形并通过；`npm run build:renderer` 与 `npm run lint` 通过。
- [ ] （修订 1）滑块轨道约 24px 高、呈胶囊形，拖块为约 28px 的白色圆形并压在轨道上；卡片标题与 Model 名居中；整体与 `research/thinking-card-reference.png` 一致（闪电、重置、`>` 除外）。
- [ ] （修订 1）拖动时拖块与填充连续跟随指针，松手、点击或按 ←/→ 时带约 200ms 的过渡吸附到选项点；`prefers-reduced-motion` 下没有过渡。
- [ ] （修订 2）模型列表首选宽度为 360px，窄窗口下收回到视口以内。
