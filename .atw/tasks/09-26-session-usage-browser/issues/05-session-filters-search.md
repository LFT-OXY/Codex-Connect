# 05 — 筛选、搜索与大列表

**What to build:** 用户可按 Harness、时间范围（全部/7/30/90 天）、项目筛选，按标题/项目/模型/ID 搜索；列表顶部显示「N 个主线程 · M 个子代理已折叠」；数千行时滚动流畅。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** ready

## Acceptance criteria

- [ ] 筛选、搜索、排序在 Renderer 本地完成，状态仅存在于当前页面
- [ ] Harness 标签只显示实际有会话的 Harness
- [ ] 列表按需或分批渲染，数千行不卡顿
- [ ] 会话读取进度与单来源失败提示
- [ ] 假 DOM 测试覆盖筛选组合与折叠汇总文案
