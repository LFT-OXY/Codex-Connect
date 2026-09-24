# Discover 决策记录：拆分模型与思考选项药丸

来源：2026-09-24 `/atw-askme-with-docs` 访谈（Q1–Q19），用户已确认共识。

## 现状事实（已核对代码）

- 合并药丸实现在 `packages/renderer-extension/src/renderer-model-picker.ts`，仅外部 Harness Thread 显示（`renderer-composer-dom.ts:803`，`state.agent !== "codex"`）。
- 触发器显示"模型名 + 思考 label"；主菜单上半 Thinking 列表、下半"Model ›"悬停展开模型子菜单（搜索 + 收藏）；无思考选项时走 `openModelMenu(true)` 独立模式。
- 思考选项为 Harness 定义的有序 `{id, label}`（`shared-contracts/src/harness-models.ts`），模型用 `supportedThinkingOptionIds` 声明子集。Claude Code：`Off, Auto, Low, Medium, High, Extra High, Max`；Antigravity：`Low/Medium/High`。
- label 为 Harness 原文，renderer 不做本地化。
- 切换模型后的思考选项回退由 Harness 返回的 `HarnessModelSelectionState` 决定（Host 校验见 `host-runtime/src/app-server-host.ts:1929`）。

## 决策

| # | 决策 |
|---|---|
| Q1 | 仅改外部 Harness 注入药丸；原生 Codex 选择器不动 |
| Q2 | 术语统一为 Thinking Option / 思考选项（已写入 `docs/project/领域术语表.md`） |
| Q3 | 顺序 `[模型药丸][思考药丸]`；模型药丸显示模型名，`resolvedModelLabel` 与模型名不同时作为次要文字；思考药丸只显示当前选项 label |
| Q4 | 模型药丸直接打开现有模型列表（独立模式，保留搜索/收藏）；删除"主菜单 → Model ›"层级 |
| Q5 | 无选项 / 仅 `off` / `thinkingSelectionSupported === false` → 隐藏思考药丸；仅一个选项 → 显示药丸，卡片可开，滑块只读 |
| Q6 | 滑块按 Harness 顺序铺开全部选项（不区分 Off/Auto 等非档位项），不改合约 |
| Q7 | 卡片无闪电、无重置、无 `>`；仅"当前选项名（大）+ 模型名（小）+ 滑块" |
| Q8/Q11 | 填充长度与颜色随相对位置 `index/(n-1)` 变化；颜色从主题强调蓝插值到紫，亮/暗主题各一套 |
| Q8/Q12 | 填充段星点纹理，密度与亮度随位置增加；慢速轻微闪烁，`prefers-reduced-motion` 下静态 |
| Q13 | 第 0 位（如 `Off`）空填充、无星点，不加额外提示 |
| Q9 | 可拖动 / 点击点跳转 / ←→ 键；拖动仅更新卡片预览文字，松手或点击时提交一次；提交后卡片保持打开，点外部或 Esc 关闭 |
| Q10 | 选完模型不自动弹出思考卡片；两药丸独立；回退结果由 Harness 选择状态决定 |
| Q14 | label 使用 Harness 原文，不在 renderer 按 id 翻译 |
| Q15 | 卡片宽约 240–260px，锚定思考药丸上方左对齐，视口内收回；沿用 `MENU_CLASSES` 视觉与 `renderer-model-picker-positioning.ts` 定位模式 |
| Q16 | 窄窗下模型药丸沿用现有压缩与省略；思考药丸 `flex: none` 不压缩 |
| Q17 | `selecting` 时两个药丸都禁用；卡片若打开则保持打开，滑块暂时禁用，完成后恢复（沿用 `keepOpenMenu` 语义） |
| Q18 | 纯函数单元测试：位置→填充比例/颜色/星点、药丸显隐与只读判定；覆盖 1、2、7 个及仅 Off 情形。视觉由用户 `npm start` 目测 |
| 默认 | 滑块 `role="slider"`，`aria-valuetext` 为当前选项 label |

不写 ADR：决策可逆、无需额外背景。
