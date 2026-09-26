# 03 — Pi 会话

**What to build:** 会话列表出现 Pi 会话，含用量与轮数/编辑数；可一键恢复到 Codex。

**Blocked by:** 01
**Cross-task prerequisites:** usage-dashboard 05（Pi 读取）
**Status:** done
**Impl:** ready

## Acceptance criteria

- [x] 标题复用现有 Pi 会话导入的标题提取；轮数为用户消息数；编辑数为含编辑类工具调用的轮数
- [x] 恢复复用 Pi 已有的会话导入能力
- [x] Adapter 与 Host 请求层测试

## 实现记录

- 标题复用 `piUserMessageTitle`（从会话导入中提取，两处共用）；摘要中的标题折叠空白并截到 120 字，避免把长提示词整段存进游标与 Host 状态。未命名会话的标题因此会包含首条用户消息的开头，这是 PRD 指定的口径（与会话导入页一致）。
- 父子关系取会话头 `parentSession`：子代理为父会话 ID，Fork 为父会话文件路径（取文件名 `_` 后的 ID）；两者都折叠。
- Pi 游标升到 formatVersion 2。
- 审查后调整（提交 b036cfb4，用户决定）：Fork（`parentSession` 为文件路径）不再折叠，单独成行、可单独恢复；只有子代理（`parentSession` 为会话 ID）折叠。恢复命令由 Adapter 的 `nativeUsage.resumeCommand` 提供。
