# 02 — 统计块：7 天/30 天/日均/对话数

**What to build:** 用量页显示最近 7 天、最近 30 天、日均、所选范围对话数，以及开始使用日期与活跃天数。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

## Acceptance criteria

- [x] 口径与 TokenTracker 一致：日均 = 最近 30 天总量 ÷ 其中有用量的天数；对话数为所选范围之和；活跃天数为有用量的天数
- [x] 经 Host 请求层测试覆盖口径与边界（无数据、仅一天数据）
- [x] 产品文档同步更新

## Implementation notes

- 契约：结果新增 `stats{last7Days,last30Days,dailyAverage,activeDays,firstActiveDate}`，见 `.atw/spec/host-runtime/node/local-usage.md`；统计块的对话数直接用 `totals.conversations`。
- 口径决定：活跃日 = Token > 0 且不晚于今天；开始使用日期与活跃天数统计全部已统计历史（TokenTracker 取自 52 周热力图，热力图不在本任务范围）；日均分母不含只有对话的日期（TokenTracker 按有记录的日期计，此处按验收原文「有用量的天数」）。
- 测试：`packages/host-runtime/test/local-usage.test.ts`（口径、边界、无数据、仅一天）、`packages/shared-contracts/test/local-usage.test.ts`、`packages/renderer-extension/test/settings/usage-dashboard.test.ts`；e2e `tests/e2e/renderer-settings-usage.spec.ts` 已用本机 Chrome 运行通过。
