# 样式、图标与资源

权威文档：`docs/architecture/renderer-settings-styling.md`。本文只列写代码时最容易违反的点，以及文档没有覆盖的注入控件样式。

## 两个样式域，不能混用

| 域 | 位置 | 做法 |
|---|---|---|
| 设置页 | `src/settings/`，挂在 `settings/shell.ts` 的 `attachShadow({ mode: "open" })` 内 | Tailwind 工具类，以及遗留的 `shell.css` / `accounts.css` |
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
- "关于"页在开源地址下方渲染 `.settings-about-upstream`，链接到上游 `https://github.com/BytePioneer-AI/codex-host`，文字取 `messages.aboutUpstream`。这是设置页中唯一允许出现上游仓库地址的位置，由 `test/settings/pages.test.ts` 的 About 用例断言。
- Agent 品牌图标放在 `src/assets/`，来源与许可写在 `src/assets/README.md`。新增图标时要补记来源；与 `packages/adapters/<x>/assets/icon.svg` 共用的标志保持逐字节一致。
- `settings/*.preview.html`、`accounts-quota-interactive.prototype.html` 是静态设计稿，源码、构建脚本和测试都没有引用它们，不要把它们当作生产 UI 修改，也不要从 `src/*.ts` 引用它们。
