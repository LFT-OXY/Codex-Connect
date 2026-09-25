# 03 — Pi 会话

**What to build:** 会话列表出现 Pi 会话，含用量与轮数/编辑数；可一键恢复到 Codex。

**Blocked by:** 01
**Cross-task prerequisites:** usage-dashboard 05（Pi 读取）
**Status:** ready-for-agent
**Impl:** ready

## Acceptance criteria

- [ ] 标题复用现有 Pi 会话导入的标题提取；轮数为用户消息数；编辑数为含编辑类工具调用的轮数
- [ ] 恢复复用 Pi 已有的会话导入能力
- [ ] Adapter 与 Host 请求层测试
