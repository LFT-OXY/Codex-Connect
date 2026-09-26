# 07 — 替换旧「会话导入」页

**What to build:** Hermes、DSH 的可导入会话并入新列表（用量栏为空，可恢复），旧「会话导入」设置页移除，新「会话」页成为唯一入口。

**Blocked by:** 02, 03, 04, 05, 06
**Status:** done
**Impl:** ready

## Acceptance criteria

- [x] sessionImport 候选按 Native Session 与已有行去重后并入
- [x] Hermes、DSH 行用量显示为空而非 0，不提供复制指令
- [x] 旧页面及其孤儿代码移除；原页的搜索、打开失败处理等能力在新页中都有对应
- [x] Host 请求层测试覆盖候选并入与去重
- [x] docs/architecture/harness-session-import.md 与 docs/index.md 更新

## 实现记录

- 并入范围：只并入**没有原生用量读取能力**、但实现了 `sessionImport.resolveCandidate` 的 Harness（当前 Hermes、DSH）的候选；Claude Code、Pi、oh-my-pi 的会话来自原生记录摘要，不再额外并入其导入候选（否则从未产生 Token 的会话会以空用量出现）。与已有行按 (Harness, Native Session ID) 去重。
- 候选在 `refresh: true` 查询时重新列举，进度轮询沿用上次结果；列举失败或返回不合规数据的 Harness 进入 `failures`。
- 移除：旧页面 `session-import-page.ts`、`session-import-list-controls.ts`、对应 CSS、`sessionImport*` 文案与页面标签/图标、Renderer 客户端中只被旧页使用的 `listSessionImportSources` / `listHarnessSessions`，以及设置生命周期与绑定探针的 `getSessionImportClient`。Host 的 `sources` / `list` RPC 属于公开 Host 协议（并有 DSH 兼容别名），保留。
- 旧页能力在新页的对应：搜索 → 筛选与搜索；导入并打开 → 恢复；打开失败的项目路径与重试打开 → 恢复失败面板；运行中提示 → 「运行中」并禁用恢复；「先在原生客户端关闭会话」的说明并入页面描述；分页 → 分批渲染。
- 审查后调整（提交 b036cfb4）：候选列举移入 `local-session-candidates.ts`，每个 Harness 最多等 5 秒，重复 ID 视为失败（与导入器一致）；零 Token 会话不列出经用户确认。
