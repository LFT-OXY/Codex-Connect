# 02 — Codex 会话

**What to build:** 会话列表出现官方 Codex 会话，子线程折叠进主线程；点「恢复」在 Codex Desktop 中打开该会话。

**Blocked by:** 01
**Cross-task prerequisites:** usage-dashboard 04（Codex 读取器）
**Status:** ready-for-agent
**Impl:** ready

## Acceptance criteria

- [ ] 实现前核实 Codex CLI 会话是否出现在 Codex Desktop 侧栏；若否，停下并回到规格讨论
- [ ] 标题取 session_index 的 thread_name，轮数按 turn_context（无则 user_message），编辑数按编辑类工具调用轮数
- [ ] 子线程按 forked_from_id / parent_thread_id 建树折叠，子线程用量计入主线程
- [ ] 读取器与 Host 请求层测试
