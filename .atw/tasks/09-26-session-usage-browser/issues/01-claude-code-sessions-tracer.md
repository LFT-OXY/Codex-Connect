# 01 — 会话页首条链路：Claude Code

**What to build:** 用户在设置中打开新的「会话」标签页（与其他设置页同尺寸），看到本机 Claude Code 主会话列表，每行显示标题、项目、模型、最后活动时间、活跃时长、Token、费用、轮数、编辑数，子代理已合并；点「恢复」即在 Codex Desktop 中以 Thread 打开并可继续。旧「会话导入」页在本票中保留不动。

**Blocked by:** None — can start immediately
**Cross-task prerequisites:** usage-dashboard 01（原生用量读取能力与 Host 用量服务）、usage-dashboard 03（计价）
**Status:** done
**Impl:** ready

## Acceptance criteria

- [x] 原生用量读取能力扩展出会话摘要（Native Session ID、可选父会话、标题、工作目录、模型、首末时间、活跃时长、轮数、编辑数），不含正文
- [x] Claude Code 摘要口径沿用 TokenTracker（ai-title 标题、轮数与编辑数规则、subagents 合并）
- [x] Host 会话服务与用量服务共享读取与持久化，按 Native Session 关联 Token 与费用，标注是否已映射为 Thread
- [x] 会话列表查询与恢复动作的契约、Host 路由、Renderer 客户端；始终使用本地 Host
- [x] 恢复：已映射直接打开对应 Thread；未映射复用会话导入完成映射后打开，不复制 Transcript
- [x] 恢复失败时显示原因，并提供「重试打开」「复制项目路径」
- [x] 主切入点测试：临时目录伪造记录 + 映射状态，经 Host 请求层断言行字段、子代理合并、已映射标注与恢复结果
- [x] 渲染有假 DOM 测试；新增或更新产品文档

## 实现记录

- 契约：`HarnessNativeUsageBatch.sessions?: HarnessNativeSessionSummary[]`，每份摘要以 `key`（如记录文件）为单位整体替换；`parentSessionId` 表示子代理/子会话。活跃时长、轮数、编辑数的累积由 harness-adapter 的 `NativeSessionActivity` 辅助函数完成，Adapter 把它放在游标中增量续算。
- Claude Code：游标升到 formatVersion 2，每个文件保存摘要与 `summarized` 偏移；因流式回复重读的行不再计入摘要。子代理文件摘要的 ID 为 `<sessionId>/<agent 文件名>`、父会话为 `sessionId`。标题取 `custom-title`，否则 `ai-title`（TokenTracker 只用 `ai-title`，这里多认用户命名）。
- 折叠口径：Token 与费用含子代理；轮数、编辑数、活跃时长只算主会话自身（PRD 只要求用量计入主会话；TokenTracker 对 Claude 会把子代理文件的轮数也加总，这里不跟随）。
- 审查后调整（提交 b036cfb4）：主会话 ID 改取文件名；中断提示按前缀 `[Request interrupted by user` 排除；编辑工具名移入 Adapter；状态 v2 迁移保留历史用量。
- Host：用量状态升到 formatVersion 3（新增 `sessions`、`sessionUsage`），旧文件从原生记录重建；会话查询 `codexhost/sessions/query` 与用量查询共享读取；从未产生 Token 的会话不列出。
- 恢复：Renderer 复用 `codexhost/harness/session-import/import`（已映射时直接返回既有 Thread）后打开 Thread；设置对话框不放大（沿用用量页 2026-09-26 取消放大的决定）。
