# 04 — oh-my-pi 会话与一键恢复

**What to build:** oh-my-pi 获得会话导入能力：它的会话出现在列表中并能一键恢复到 Codex。

**Blocked by:** 01
**Cross-task prerequisites:** usage-dashboard 06（oh-my-pi 读取）
**Status:** done
**Impl:** ready

## Acceptance criteria

- [x] oh-my-pi Adapter 实现 sessionImport（列举候选、只读重新校验），行为与 Pi 对齐
- [x] 会话摘要口径与 Pi 一致，子代理按原生父子关系折叠
- [x] 恢复沿用其已有的按 Native Session 打开能力
- [x] Adapter 会话导入测试与 Host 请求层测试
- [x] docs/architecture/harness-session-import.md 增加 oh-my-pi

## 实现记录

- `omp-session-import.ts`：`OmpSessionImportIndex`（列举 + 只读重新校验，指纹缓存、歧义检查），与 Pi 实现同构；会话目录解析 `ompSessionsDirectory` 移入该模块，用量读取器从这里引用。候选扫描会话目录与下一层，跳过与会话文件同名的子代理文件夹。
- 本机核对（只读）：`~/.omp/agent/sessions` 顶层 324 个文件中 229 个成为候选，其余为没有用户消息分支或项目目录已不存在，与 Pi 的规则一致。
- 摘要：标题取标题槽（原地改写，按修改时间变化重读首行）→ 会话头 `title` → 首条用户消息；子代理父会话由所在文件夹对应的父文件确定（全部文件读完后再产出摘要），Fork 由 `parentSession` 确定。omp 游标升到 formatVersion 2（新增 `mtimeMs` 与摘要）。
- Adapter 内原用量专用的中止控制器与请求集合改为读取原生文件共用（`#readNative`）。
