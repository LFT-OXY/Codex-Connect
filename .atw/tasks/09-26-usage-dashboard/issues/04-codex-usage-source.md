# 04 — 接入官方 Codex 用量

**What to build:** 本机 Codex 原生会话记录的用量进入统计，用量页出现 Codex 卡片并参与占比、明细与统计块。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** ready

## Acceptance criteria

- [ ] host-runtime 的 Codex 运行时提供同形状的读取器，读取 sessions 与 archived_sessions（遵循 CODEX_HOME）
- [ ] 累计值差分、输入扣除缓存、模型取最近 turn_context、Fork 重放段跳过、对话数按非零 token_count 事件计
- [ ] 推理已含在输出中，不重复计 Token 与费用
- [ ] 读取器测试覆盖上述格式边角；Host 请求层测试断言 Codex 卡片
- [ ] 产品文档同步更新
