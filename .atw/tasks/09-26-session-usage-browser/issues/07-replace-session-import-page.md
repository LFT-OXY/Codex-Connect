# 07 — 替换旧「会话导入」页

**What to build:** Hermes、DSH 的可导入会话并入新列表（用量栏为空，可恢复），旧「会话导入」设置页移除，新「会话」页成为唯一入口。

**Blocked by:** 02, 03, 04, 05, 06
**Status:** ready-for-agent
**Impl:** ready

## Acceptance criteria

- [ ] sessionImport 候选按 Native Session 与已有行去重后并入
- [ ] Hermes、DSH 行用量显示为空而非 0，不提供复制指令
- [ ] 旧页面及其孤儿代码移除；原页的搜索、打开失败处理等能力在新页中都有对应
- [ ] Host 请求层测试覆盖候选并入与去重
- [ ] docs/architecture/harness-session-import.md 与 docs/index.md 更新
