# 讨论结论：订阅额度样式重做

来源：2026-09-25～26 与用户的需求访谈（atw-askme-with-docs）。参考对象为用户长期使用的开源工具 TokenTracker（MIT，`/Users/oxy/Documents/Configuration/dev-environment/demo/源码/TokenTracker`）的「限额」页截图与源码。

## 用户已决定

- 改造位置：只改「设置 → 账号」页的额度展示；Composer 里的额度药丸与弹层不动。
- 样式目标：参照 TokenTracker「限额」页——按 Harness 分组，每个额度窗口一条横条，横条上有节奏标记（时间进度竖线），右侧显示百分比与距重置的剩余时间。
- 保留/新增按钮：刷新按钮保留；预测性提醒按钮、订阅登记按钮不做。
- Codex 重置卡：做，画成截图中「重置 1 / 重置 2」那样逐张横条。
- 不照抄 TokenTracker 代码，参照思路自行实现，不带原作者署名。

## Agent 替用户定的小事（用户已在总结中确认）

- 账号页保留现有「已用/剩余」切换，以及账号邮箱、套餐信息。
- Grok、agy 的额度也换成新样式。

## 调研事实

- 现有账号页：表格「账号 / 5 小时 / 7 天 / 用于 Harness」，工具栏有搜索、已用/剩余切换、全局刷新；下方「Pi 中的账号」专区。完整产品说明见 `docs/product/codex-accounts.md`。
- 额度数据链路已完整：Codex 走官方 `account/rateLimits/read`；Claude Code、Grok、agy 走 `HarnessAdapter.inspectAccount()` → `codexhost/harness/accounts/*`。
- 额度契约 `AccountCreditsSnapshot`：`usedPercent`、`resetsAt`、`periodType`（weekly/monthly/five_hour/seven_day/unknown）、`productUsage[]`（仅 product/usagePercent/resetsAt，无窗口长度）、`resetCredits`（availableCount、nextExpiresAt、expiresAt[]）。
- Codex 重置卡目前只解析出每张的到期时间，没有发放时间；TokenTracker 的逐张横条长度 = 该卡剩余寿命占（发放→到期）的比例，需要发放时间。
- TokenTracker 节奏标记算法：标记位置 = 窗口已流逝时间 / 窗口总长；仅已用 ≥5% 时显示；实际已用超过标记 3 个百分点以上显示警示色。颜色阈值：已用 ≥90 红、≥70 琥珀、其余绿。右侧剩余时间 <60 分钟显示 m，<24 小时显示 h，否则 d。
