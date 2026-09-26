# 02 — Codex 会话

**What to build:** 会话列表出现官方 Codex 会话，子线程折叠进主线程；点「恢复」在 Codex Desktop 中打开该会话。

**Blocked by:** 01
**Cross-task prerequisites:** usage-dashboard 04（Codex 读取器）
**Status:** done
**Impl:** ready

## Acceptance criteria

- [x] 实现前核实 Codex CLI 会话是否出现在 Codex Desktop 侧栏；若否，停下并回到规格讨论
- [x] 标题取 session_index 的 thread_name，轮数按 turn_context（无则 user_message），编辑数按编辑类工具调用轮数
- [x] 子线程按 forked_from_id / parent_thread_id 建树折叠，子线程用量计入主线程
- [x] 读取器与 Host 请求层测试

## 实现记录

- 核实（2026-09-26）：Codex Desktop（ChatGPT.app 内的 webview 代码）本地模式列最近 Thread 时 `thread/list` 的 `sourceKinds` 为空数组、`originators` 未设置，即 app-server 的默认交互来源（CLI 与 Desktop）；`~/.codex/state_5.sqlite` 的 `threads` 表中确有 `source = cli` 的行。结论：Codex CLI 会话出现在侧栏，按规格实现。
- 打开方式沿用 `openRendererThread`（在侧栏找到行并点击）。侧栏只加载最近的 Thread（默认 50），更早的会话找不到时显示专门提示与重试；Codex Desktop 支持 `codex://threads/<id>` 深链，但扩展内没有已验证的调用入口，未采用。
- 摘要以 Session ID 为 key（不以文件路径），归档移动后替换同一份摘要；标题来自 `session_index.jsonl`，游标记录其读取位置与已读名字，重命名时即使 rollout 未变也重新产出摘要。
- 父子关系：`forked_from_id` → `parent_thread_id` → `source.subagent.thread_spawn.parent_thread_id`。
- Host 会话视图中官方 Codex 行的 `threadId` 即 Native Session ID、`resumable` 恒为 true。
