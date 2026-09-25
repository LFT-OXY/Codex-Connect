# 04 — oh-my-pi 会话与一键恢复

**What to build:** oh-my-pi 获得会话导入能力：它的会话出现在列表中并能一键恢复到 Codex。

**Blocked by:** 01
**Cross-task prerequisites:** usage-dashboard 06（oh-my-pi 读取）
**Status:** ready-for-agent
**Impl:** ready

## Acceptance criteria

- [ ] oh-my-pi Adapter 实现 sessionImport（列举候选、只读重新校验），行为与 Pi 对齐
- [ ] 会话摘要口径与 Pi 一致，子代理按原生父子关系折叠
- [ ] 恢复沿用其已有的按 Native Session 打开能力
- [ ] Adapter 会话导入测试与 Host 请求层测试
- [ ] docs/architecture/harness-session-import.md 增加 oh-my-pi
