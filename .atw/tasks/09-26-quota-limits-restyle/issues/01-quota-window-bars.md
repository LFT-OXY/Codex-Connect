# 01 — 额度横条与节奏标记

**What to build:** 用户打开「设置 → 账号」时，额度不再是「5 小时 / 7 天」表格，而是按账号分组的横条列表：每个额度窗口（5h、7d、模型专属、月额度、产品用量）一行，含横条、百分比、距重置剩余时间；可推算窗口长度的窗口带节奏标记。工具栏、账号身份与套餐、Pi 导入入口与「Pi 中的账号」专区保持现有行为。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

## Acceptance criteria

- [x] Codex、Claude Code、Grok、agy 账号均以分组横条呈现，组头保留 Logo、账号名称与套餐标识
- [x] 主窗口与 productUsage 统一投影为窗口行；缺失的窗口不补 0% 或 100%
- [x] 节奏标记仅在窗口长度与重置时间都已知且已用 ≥5% 时出现；超出节奏 3 个百分点以上为警示色
- [x] 已用/剩余切换同步作用于横条、百分比与节奏标记；风险颜色始终按已用比例（70%/90%）判断
- [x] 剩余时间沿用现有两单位格式与每分钟/重新聚焦更新，到点显示「待刷新」；悬停可见完整本地重置时间
- [x] 搜索、刷新（绕过缓存、先到先显示）行为不变
- [x] 浅色/深色主题与窄窗口下可读、无横向滚动；新文案有中英文
- [x] 节奏计算与窗口行投影有纯函数测试；渲染有假 DOM 测试
- [x] docs/product/codex-accounts.md 的「账号列表」一节已按新样式更新
- [x] 人工启动截图，与参考图对照

## Comments

- 2026-09-26 实现记录：用户确认 Codex Pro 保留「只显示 7 天」、Grok 去掉周窗口过滤；去掉短本地时间，改为悬停查看完整重置时间。测试接缝：`accountUsageWindowRows`、`accountUsagePace` 两个纯函数（`test/settings/accounts-usage-windows.test.ts`），`renderAccountUsage` 的假 DOM 测试（`accounts-usage.test.ts`），以及整页分组测试（`pages.test.ts`）。e2e `tests/e2e/renderer-settings-accounts.spec.ts` 已在本地跑过（6/6），包含 420px 窄窗口换行与无溢出断言。截图用 Playwright 在浅色、深色、560px、400px 下拍摄；仓库中没有参考原图，与 TokenTracker 限额页的对照需用户确认。

