# 02 — 统计块：7 天/30 天/日均/对话数

**What to build:** 用量页显示最近 7 天、最近 30 天、日均、所选范围对话数，以及开始使用日期与活跃天数。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** ready

## Acceptance criteria

- [ ] 口径与 TokenTracker 一致：日均 = 最近 30 天总量 ÷ 其中有用量的天数；对话数为所选范围之和；活跃天数为有用量的天数
- [ ] 经 Host 请求层测试覆盖口径与边界（无数据、仅一天数据）
- [ ] 产品文档同步更新
