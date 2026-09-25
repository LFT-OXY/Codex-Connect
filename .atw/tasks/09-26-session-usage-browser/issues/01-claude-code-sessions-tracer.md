# 01 — 会话页首条链路：Claude Code

**What to build:** 用户在设置中打开新的「会话」标签页（放大尺寸），看到本机 Claude Code 主会话列表，每行显示标题、项目、模型、最后活动时间、活跃时长、Token、费用、轮数、编辑数，子代理已合并；点「恢复」即在 Codex Desktop 中以 Thread 打开并可继续。旧「会话导入」页在本票中保留不动。

**Blocked by:** None — can start immediately
**Cross-task prerequisites:** usage-dashboard 01（原生用量读取能力与 Host 用量服务）、usage-dashboard 03（计价）
**Status:** ready-for-agent
**Impl:** ready

## Acceptance criteria

- [ ] 原生用量读取能力扩展出会话摘要（Native Session ID、可选父会话、标题、工作目录、模型、首末时间、活跃时长、轮数、编辑数），不含正文
- [ ] Claude Code 摘要口径沿用 TokenTracker（ai-title 标题、轮数与编辑数规则、subagents 合并）
- [ ] Host 会话服务与用量服务共享读取与持久化，按 Native Session 关联 Token 与费用，标注是否已映射为 Thread
- [ ] 会话列表查询与恢复动作的契约、Host 路由、Renderer 客户端；始终使用本地 Host
- [ ] 恢复：已映射直接打开对应 Thread；未映射复用会话导入完成映射后打开，不复制 Transcript
- [ ] 恢复失败时显示原因，并提供「重试打开」「复制项目路径」
- [ ] 主切入点测试：临时目录伪造记录 + 映射状态，经 Host 请求层断言行字段、子代理合并、已映射标注与恢复结果
- [ ] 渲染有假 DOM 测试；新增或更新产品文档
