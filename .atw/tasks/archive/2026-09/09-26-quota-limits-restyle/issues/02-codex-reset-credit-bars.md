# 02 — Codex 重置卡逐张横条

**What to build:** Codex 账号组下方逐张列出可用重置卡：每张一条表示剩余寿命的横条，右侧显示本地到期时间；接口未提供发放时间的卡只显示到期时间，不画横条；没有重置卡时不显示该区域。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

## Acceptance criteria

- [x] 重置卡契约新增按卡明细（到期时间、可选发放时间），旧字段保留、向后兼容
- [x] Host 解析官方重置卡响应时读取每张卡的发放时间
- [x] 寿命横条长度 = 距到期剩余时长 /（到期 − 发放）
- [x] 缺发放时间、无重置卡、异常值三种情况的呈现正确，不编造比例或「0 张」
- [x] 不提供使用重置、不调用消耗接口
- [x] 契约、解析与渲染均有测试
- [x] docs/product/codex-accounts.md 的「重置卡」一节已更新

## Comments

- 2026-09-26 实现记录：官方协议（codex-cli 0.156.1 `app-server generate-ts`）的 `RateLimitResetCredit` 带 `grantedAt`（Unix 秒）与可空 `expiresAt`。契约新增 `resetCredits.credits[]`（`expiresAt`、可选 `grantedAt`），旧字段 `nextExpiresAt`/`expiresAt[]` 保留，数组上限导出为 `ACCOUNT_RESET_CREDITS_MAX_LENGTH`（32），解析端超出时保留最早到期的 32 张。发放时间无效或不早于到期时只保留到期时间。
- 呈现改为直接列出（去掉原「重置卡 N 张」展开入口与页面级展开状态）：小标题「重置卡 N 张」，每张一行「重置 N」+ 寿命横条 + 本地到期时间，悬停可见含年份时区的完整时间。距到期 ≤24h 警示色、≤8h 强调色（沿用原「最早到期」一行的阈值，扩展到逐张）。横条按渲染时刻计算，不挂页面时钟。
- 已知未覆盖：永不过期（`expiresAt: null`）的卡不列行，只计入小标题张数，是否显示为「不过期」待用户决定。
- 测试接缝：`accountResetCreditsSchema`、`observeCodexRateLimitResetCredits` / `projectCodexRateLimitsToCredits`、`AccountRateLimits` 缓存、`renderAccountResetCredits` 假 DOM、`pages.test.ts` 整页、e2e（6/6，本机 Chrome；含 420px 无溢出）。截图检查了深色/浅色、宽/窄、中/英文。全量 vitest 仅 opencode、claude-code 两个「未安装」用例因本机已安装 CLI 而失败，与本工单无关。
