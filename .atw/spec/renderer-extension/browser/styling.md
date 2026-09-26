# 样式、图标与资源

权威文档：`docs/architecture/renderer-settings-styling.md`。本文只列写代码时最容易违反的点，以及文档没有覆盖的注入控件样式。

## 两个样式域，不能混用

| 域 | 位置 | 做法 |
|---|---|---|
| 设置页 | `src/settings/`，挂在 `settings/shell.ts` 的 `attachShadow({ mode: "open" })` 内 | Tailwind 工具类，以及遗留的 `shell.css` / `accounts.css`（账号页额度横条已迁到 Tailwind，见下文） |
| 注入 Desktop 文档的控件 | Composer 尾部 chip、Model 菜单、`@` 提及菜单等 | 自带小样式表 + 内联尺寸，**禁止**使用本项目的 Tailwind 类 |

- Desktop 自身也用 Tailwind v4，类名、`--tw-*` 变量和 layer 名都会冲突，所以 Tailwind 编译结果只能进入设置页的 Shadow DOM。
- 注入控件的样式按“一个模块一个 `<style data-codexhost-…-style>`，幂等插入”的方式写：`renderer-trigger-chip-style.ts#ensureRendererTriggerChipStyle`、`renderer-model-option-style.ts`、`renderer-delegation-mention.ts`。插入前用属性选择器查重，选择器以 `codexhost-` class 或 `data-codexhost-*` 属性为作用域。
- 需要 `:hover` / `:disabled` / `[data-state="open"]` 这类伪类时写进样式表；每个控件自己的高度、内边距和挤压宽度用内联 style 设置（`applyRendererTriggerChipSqueezeTrigger`）。不要复制 Desktop 的私有 class 或设计 token（事故记录见该文件头注释，提交 `fb4f94d8` 处理了侧边栏收窄时的 chip 挤压）。
- **已知例外**：模型列表与思考卡片的外框共用 `renderer-model-picker.ts` 导出的 `MENU_CLASSES`（`bg-token-dropdown-background/90`、`text-token-foreground` 等 Desktop Tailwind 类），这是为了让两个弹层外观一致，经 `split-model-thinking-pills` 任务确认保留。Desktop 改名这些 token 时两者会一起失去底色。不要再把它扩展到新控件；新弹层的配色放进自己的 `data-codexhost-*` 样式表，用自定义常量加 `light-dark()` 跟随宿主 color-scheme（参见 `renderer-thinking-option-style.ts`、`renderer-usage-control.ts#applyRendererPopoverChrome`）。
- 动画必须在 `@media (prefers-reduced-motion: reduce)` 下关闭（例如思考滑块的星点闪烁与填充过渡）。
- 需要"拖动时连续跟随、松手后动画吸附"的控件，用状态属性区分按下和移动，只在真正移动时关闭过渡。例如思考滑块：`pointerdown` 设 `data-dragging="pressed"`，保留 `0.2s ease-out` 过渡，所以点击会以动画吸附；`pointermove` 改为 `"moving"`，样式表只对 `[data-dragging="moving"]` 设 `transition: none`；松手时先删除该属性，再写入吸附位置，过渡才会生效。不要在 `pointerdown` 时就关闭过渡，否则点击会瞬间跳到目标位置。
- 循环动画需要按状态变速时（例如思考滑块的流动速度随档位变化），**不要改 `animation-duration`**。进行中的动画会按新周期重算进度，产生跳帧。正确做法是：CSS 中的周期固定为基准值，用 `element.getAnimations()` 找到对应的 `CSSAnimation`（按 `animationName` 区分），再调用 `updatePlaybackRate(基准时长 / 目标周期)`。要注意两点：一是新速率在下一帧才生效，测试读取 `playbackRate` 前需要先 `await animation.ready`；二是元素隐藏（例如 popover 关闭）时动画对象不存在，显示后要重新设置速率。见 `renderer-thinking-option-picker.ts#syncFlowSpeed`。

## 设置页 Tailwind 规则（摘自架构文档，均已在代码中落地）

- 入口 `settings/tailwind.css` 只 import `theme.css` 与 `utilities.css`，不带 preflight，`@source "./"`，并用 `--color-*: initial` 关掉默认调色板，只映射 `settings-*` 颜色与 `white` / `black`。
- 类名必须在源码里完整出现，不能写 `bg-settings-${state}` 这种拼接；状态切换用 `data-[state=…]:` 变体或对象映射。
- 同一个元素不要同时使用旧 CSS 类和 Tailwind 类（旧 CSS 不在 layer 里，优先级更高）。
- 可复用控件（分组卡片、`role="switch"` 开关、带单位的数字输入、`role="tooltip"` 问号浮窗）放在 `settings/preference-ui.ts`，页面里不要复制长串类名。
- `shell.css` / `accounts.css` 暂不整体迁移；大改某个页面时顺带把它迁到 Tailwind，并删掉对应的旧样式。

## 账号页额度横条（`settings/accounts-*.ts`）

「设置 → 账号」的额度是按账号分组的横条（2026-09 `quota-limits-restyle`），替代原来的 `settings-account-table`。

| 模块 | 职责 |
|---|---|
| `accounts-usage-windows.ts` | 纯函数：`accountUsageWindowRows(credits, messages, filter?)` → `AccountUsageWindowRow[]`（`label`、`usedPercent`、可选 `resetsAt`、可选 `windowMs`）；`accountUsagePace(window, display, now?)` → `{ position, ahead } \| null`；重置卡的 `accountResetCreditLife(credit, now?)` → 0～100 或 `null`（缺发放时间、时间无效、发放不早于到期），`accountResetCreditTone(expiresAtMs, now?)` → 距到期 ≤8h `hot`、≤24h `warn`，否则 `ok`。不依赖 DOM。 |
| `accounts-usage.ts` | `renderAccountUsage(...)` 返回一个元素：一行一个窗口，或加载/失败/空状态消息；`renderAccountResetCredits(document, credits, messages, now?)` 返回重置卡区域或 `null`（无 `resetCredits` 时），窗口行与重置卡行共用 `renderMeter` 与行/横条类名 |
| `accounts-reset-time.ts` | 倒计时 `<time data-resets-at>`、节奏标记，以及 `mountAccountResetCountdowns` 页面本地时钟（每分钟和 `focus` 时刷新倒计时与节奏标记，不重建列表） |
| `accounts-list.ts` | `renderAccountGroup` / `renderHarnessAccountGroup`：组头（旧 CSS 的身份块 + Pi 入口）加窗口列表；Codex 组在窗口列表后直接追加重置卡区域（不再有展开入口和页面级展开状态） |

DOM 标记是测试、焦点恢复和 forced-colors 样式共同依赖的契约，改名时要同时改这三处：

- 分组：`[data-account-group][role="group"][aria-label=<账号名>]`，再加 `data-account-id` 或 `data-harness-id`。`accountListFocusRestorer` 按它恢复焦点。
- 窗口行：`[data-usage-window][data-tone="ok|warn|hot"]`，子元素依次是：窗口名、`[role="meter"]`（首个子元素是填充）、百分比、倒计时（没有重置时间时是空 `span`，用来占位对齐）。
- 重置卡：区域 `[data-reset-credits][role="group"][aria-label="重置卡"]`，首个子元素是「图标 + 重置卡 + N 张」小标题；之后每张卡一行 `[data-reset-credit][data-tone="ok|warn|hot"]`，子元素依次是：`重置 N`、可选的 `[role="meter"]`（寿命横条，只有 `accountResetCreditLife` 非 `null` 时才有，**不留占位**）、`<time>` 到期时间（`col-start-3 col-span-2`，窄布局 `col-start-2`，所以缺横条时也能对齐；到期时间无效时省略）。行按 `credits`，旧 Host 只给 `expiresAt[]` 时按它回退、全部不画横条。寿命横条不随「已用/剩余」切换镜像，也不挂页面时钟。
- 节奏：meter 上带 `data-pace-window-ms/-resets-at/-used/-display`，子元素 `[data-pace-marker][data-state="even|ahead"]`。只有在 `windowMs` 和 `resetsAt` 都存在时才生成；已用低于 5% 时 `hidden`。

规则：

- 风险色按已用比例（`rendererCreditsTone`）写到行上的 `data-tone`，子元素用 `group-data-[tone=…]:` 切换颜色，不要拼接类名。
- 窄布局用容器查询 `@max-[28rem]:`（容器是 `.settings-account-list`，它自带 `container-type`）：横条换到下一行，占满整行。
- forced-colors 下横条和标记的颜色**不写成 Tailwind 任意值**（`bg-[Highlight]` 违反「颜色只用 `settings-*`」），而是写在 `accounts.css` 的 `@media (forced-colors: active)`，用上面的 data 属性选择器（`[data-usage-window]` 与 `[data-reset-credit]` 两组 meter 并列）。
- 窗口长度只来自来源显式给出的周期：产品名的英文后缀（`5-hour window`、`7-day window`、`Weekly window`、`<组> · 5-hour` 等），或主窗口的 `periodType`。月额度、`unknown` 和识别不出的产品名都没有长度，因此不画节奏标记。
- Codex `planType === "pro"` 传 `filter: "weekly-only"`，只保留 7 天/周窗口；其他账号不过滤。

测试：纯函数在 `test/settings/accounts-usage-windows.test.ts`，渲染在 `accounts-usage.test.ts`（本地 FakeElement；重置卡的寿命比例、缺发放时间、旧字段回退、越界夹取、到期警示都经 `renderAccountResetCredits` 断言），整页分组在 `pages.test.ts`，布局与窄窗口在 `tests/e2e/renderer-settings-accounts.spec.ts`。

## 「用量」页（`settings/usage-*.ts`）

- 与其他设置页同尺寸（曾有按页面放大的 `size: "expanded"`，用户决定取消：Codex Desktop 的 `env(titlebar-area-height)` 为 0，放大后会盖住 macOS 红绿灯，且与其他页不一致）。不要再为单页加尺寸变体。
- 分类色：`--settings-series-1..6`（`shell.css` 的 `:host`，`light-dark()`）映射为 Tailwind `bg-settings-series-N`。类名写成完整字面量数组（`usage-dashboard.ts#SERIES_BACKGROUNDS`）按下标取，不拼接。
- `usage-dashboard.ts#renderLocalUsage(document, view: LocalUsageView, messages, tab?: { selected, select(tab) })` 只依赖 `createElement/append/setAttribute/addEventListener/dataset/style/focus`，可用假 DOM 测试；`tab` 由页面持有，切换周期或刷新后仍打开同一明细标签（缺省 `"daily"`）。`reading` 结果不交给它，由 `usage-page.ts#renderProgress` 显示。横条统一用导出的 `usageBar(document, percent, sizeClass)`（轨道 `bg-settings-surface-hover`、填充 `bg-settings-series-1`，`sizeClass` 只给高宽/外边距），项目横条与读取进度条都用它，不要再复制轨道/填充类串。`usage-page.ts` 负责周期按钮、自定义表单、刷新与请求。DOM 标记（测试与 e2e 依赖）：`[data-usage-total]`（title 为完整数）、`[data-usage-segment=<harnessId>]`（style.width 百分比）、`[data-usage-harness-card="all"|<harnessId>]`（占比用 `formatUsageShare`，横条 segment 的 title 同）、卡片内 Provider 展开 `details[data-usage-providers=<harnessId>]`（仅 `providers` 非空；首子元素 `summary`「Provider（N）」，默认收起，重渲染后重新收起）与其中 `li[data-usage-provider=<provider>]`（名称可截断、title 为全名，占比为该 Harness 内占比）、`tr[data-usage-day=<date>]`、统计块卡片 `[data-usage-stat="last7Days"|"last30Days"|"dailyAverage"|"conversations"]`（按此顺序，位于 Harness 卡片与每日明细之间，首个子元素 title 为完整数；范围为空时仍显示，`stats.firstActiveDate === null` 时整块省略）、开始使用与活跃天数行 `[data-usage-history]`、`[data-usage-period=<kind>]`（`aria-pressed`）、`form[data-usage-custom]`、`[data-usage-custom-from/to]`、`[data-usage-action="refresh"]`；明细标签 `[role="tablist"]` 内 `button[data-usage-tab="daily"|"projects"]`（`role="tab"`、`aria-selected`、roving `tabIndex`、`aria-controls` → 面板 `id` `codexhost-settings-usage-<tab>`，左右方向键切换并聚焦，照 `connections-page.ts` 的 Host 标签）与面板 `[data-usage-tab-panel]`（`role="tabpanel"`，未选中 `hidden`）；项目行 `li[data-usage-project=<project>]`（名称 title 为全名，`owner/` 为 `text-settings-muted` 前缀，末段 `font-medium`，下行 Harness 名以 ` · ` 连接，右侧 Token 数 title 为完整数与相对最多项目的 `usageBar`）；读取失败提示 `p[data-usage-failure=<harnessId>]`（`role="alert"`，`text-settings-danger`，位于结果根的最前面，每个失败 Harness 一条）；读取进度 `[role="progressbar"]`（`aria-valuemin/max/now` 为文件数，仅 `progress.total > 0` 时出现）。
- `formatUsageShare(percent)`：两位小数加 `%`；`0 < percent < 0.005` 显示 `<0.01%`，0 显示 `0.00%`。
- `formatUsageTokens`：<1000 原样；否则 K/M/B 两位小数去尾零，舍入到 1000 时进位（`999_999` → `1M`）。
- 测试：`test/settings/usage-dashboard.test.ts`、`usage-page.test.ts`；布局与深色/窄窗口在 `tests/e2e/renderer-settings-usage.spec.ts`（设置 `CODEXHOST_USAGE_SCREENSHOT_DIR` 可输出截图）。

## 构建插件

- `scripts/tailwind-esbuild-plugin.mjs` 只拦截 `renderer-extension/src/settings/tailwind.css`（esbuild 的 filter 是 Go 正则，不能带 JS flags），编译后以 `text` loader 导入。它会补上 `@layer properties, theme, base, components, utilities` 顺序声明，并把 `@property` 初始值展开到 `@layer properties`（Chromium 不会在 Shadow DOM 中注册 `@property`）。
- `scripts/build.mjs` 的 loader 映射：`.png` / `.svg` → `dataurl`，`.css` → `text`，类型声明在 `src/assets.d.ts`。所有资源都打进 bundle，**运行时不发网络请求、不读本地安装路径**。
- 任何打包 Renderer 源码的 e2e 用例都要接入 `tailwindEsbuildPlugin()` 并使用同一套 loader（参见 `tests/e2e/renderer-settings-accounts.spec.ts`）。
- 升级 Tailwind 后，检查 layer 顺序声明和 `@property` 的展开结果，并运行 `renderer-idle-release.spec.ts` 与 `renderer-settings-accounts.spec.ts`。发布包附带 `tailwindcss-LICENSE.txt` 和 `lucide-LICENSE.txt`（`scripts/release/prepare-payload.mjs`）。

## 图标与品牌资源

- lucide 按单图标深路径导入，并用 `lucide/dist/esm/createElement.mjs` 生成 SVG 元素，不要导入整个 `lucide` 运行时：
  ```ts
  import createElement from "lucide/dist/esm/createElement.mjs";
  import Check from "lucide/dist/esm/icons/check.mjs";
  ```
  新的深路径模块类型由 `assets.d.ts` 的通配声明覆盖。设置页图标集中在 `settings/icons.ts`，用 `satisfies Record<RendererSettingsIconName, IconNode>` 保证名称完整。
- 设置品牌图标（设置页头部标记、应用头部设置按钮，`settings/icons.ts#createRendererSettingsBrandIcon`）是 `src/assets/codexhost-app-icon.png`：由 `crates/launcher/assets/codexhost.png` 缩放到 128×128（约 22KB，`sips -Z 128`），以 dataurl 内联；按钮显示 24px，头部显示 32px。启动器图标换了以后要重新生成这张图。不要直接引用 1024px 源图，否则 bundle 会增加约 1.2MB。产品名文字（`shell.ts` 的 `settings-brand__name`、`trigger.ts` 的按钮标签、`pages.ts` 的 `settings-about-product`）都写 `Codex Connect`。
- 设置页不提供"关于"页和导航中的"Star 支持"链接（2026-09-25 按用户要求移除），设置页中不出现上游仓库地址。上游署名只保留在 README 致谢中，由 `tools/brand-guard.test.mjs` 断言。更新页的 Star 提示（`.settings-update-star`）保留。
- Agent 品牌图标放在 `src/assets/`，来源与许可写在 `src/assets/README.md`。新增图标时要补记来源；与 `packages/adapters/<x>/assets/icon.svg` 共用的标志保持逐字节一致。
- `settings/*.preview.html`、`accounts-quota-interactive.prototype.html` 是静态设计稿，源码、构建脚本和测试都没有引用它们，不要把它们当作生产 UI 修改，也不要从 `src/*.ts` 引用它们。
