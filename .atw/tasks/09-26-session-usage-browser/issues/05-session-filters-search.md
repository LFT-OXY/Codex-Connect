# 05 — 筛选、搜索与大列表

**What to build:** 用户可按 Harness、时间范围（全部/7/30/90 天）、项目筛选，按标题/项目/模型/ID 搜索；列表顶部显示「N 个主线程 · M 个子代理已折叠」；数千行时滚动流畅。

**Blocked by:** 01
**Status:** done
**Impl:** ready

## Acceptance criteria

- [x] 筛选、搜索、排序在 Renderer 本地完成，状态仅存在于当前页面
- [x] Harness 标签只显示实际有会话的 Harness
- [x] 列表按需或分批渲染，数千行不卡顿
- [x] 会话读取进度与单来源失败提示
- [x] 假 DOM 测试覆盖筛选组合与折叠汇总文案

## 实现记录

- `sessions-filters.ts`：纯函数 `filterSessions` 与筛选控件；Harness 标签取自结果的 `harnesses`（Host 只列出有会话的 Harness），项目选项取自当前会话。
- 分批渲染：每批 200 行，追加到同一列表（不重绘，保持滚动位置），有 `IntersectionObserver` 时滚到「显示更多」按钮即自动追加。
- 折叠汇总按筛选后的结果计算。读取进度与单来源失败提示已在工单 01 实现。
