# 03 — Estimated Cost 计价

**What to build:** 用量页在 Token 总数下方显示所选范围的费用；价格每天自动更新，离线时用内置价格；没有价格的模型不报错、费用记 0。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

## Acceptance criteria

- [x] 价格来源回退顺序：24 小时磁盘缓存 → 远程 LiteLLM 价格表 → 过期缓存 → 内置快照；手工覆盖始终优先
- [x] 模型名匹配支持精确、别名、去后缀、去厂商前缀、最长子串兜底
- [x] 费用公式按输入/输出/缓存读/缓存写/推理分项计价，推理已含在输出中的 Harness 不重复计；有自报费用时优先
- [x] 费用在查询时计算，价格更新后历史费用随之更新
- [x] 计价有纯函数测试；Host 请求层测试断言费用
- [x] 界面不额外标注「按 API 价格估算」；产品文档同步更新

## Implementation notes

- 契约：结果新增 `estimatedCostUsd`（USD），只在所选范围总额中显示（`$1,234.57`；非零但不足半美分显示 `<$0.01`），Harness 卡片与每日明细不含费用。详见 `.atw/spec/host-runtime/node/local-usage.md`「计价」。
- 模块：`local-usage-pricing.ts`（匹配与公式，纯函数）、`local-usage-prices.ts`（来源回退与 `usage/model-prices.json` 缓存）、`local-usage-price-snapshot.ts`（生成的内置快照，3319 个文本模型，`tools/update-model-price-snapshot.mjs` 刷新）。
- 决定：
  - 「手工覆盖」= 随版本维护的源码常量 `MODEL_PRICE_OVERRIDES` / `MODEL_ALIASES`，当前为空，因为本机 Claude Code / Pi / oh-my-pi 记录中的模型都能匹配到 LiteLLM。覆盖在每一步匹配中先于 LiteLLM，因此 LiteLLM 里精确存在的名称不会被覆盖表中的去后缀名压过。
  - 推理不重复计由记录契约保证：`reasoning` 只在单独上报时非 0。Host 统一按（输出 + 推理）× 输出价计算。04 的 Codex 读取器需要把 reasoning 从 output 中扣除，或者报 0。
  - 自报费用优先，包括 0（订阅通道）。Adapter 对未知费用必须省略该字段。
  - 自带费用的记录单独成桶，所以同一半小时内既有自报费用又需按价格计算的用量可以各自计费。
  - 价格只在 Host 进程第一次加载时阻塞查询；过期后先用旧价格回答并在后台刷新。离线回退（过期缓存或快照）1 小时后重试。这是审查中发现的问题：raw.githubusercontent.com 挂起时，打开页面会被拖慢最多 10 秒。
  - 最长包含名兜底只考虑长度 ≥ 5 且含字母和数字的名称。实测发现 LiteLLM 里有去前缀后为空的键，以及 `fast`、`auto` 等泛名，会把 `opus`、`<synthetic>` 误计价。
- 测试：`packages/host-runtime/test/local-usage-pricing.test.ts`、`local-usage-prices.test.ts`、`local-usage.test.ts`（请求层费用），以及 shared-contracts schema、Renderer 假 DOM 与 e2e。
- 实测（本机 Claude Code 全部记录，Asia/Shanghai，2026-09-26）：日 356M Token / $135.53，周 1.25B / $720.85，月 4.2B / $3,155.31，总计 5.96B / $4,488.00。首次查询（全量读取 + 拉取价格）约 2.8 秒。尚未与 TokenTracker 逐项对照（属于人工验证）。
