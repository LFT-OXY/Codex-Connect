# Journal - CHINHAE (Part 1)

> AI development session journal
> Started: 2026-09-24

---



## Session 1: Bootstrap 项目 spec
<!-- atw-session: v=2 fp=9b54085fa07855ba -->

**Date**: 2026-09-24
**Task**: Bootstrap 项目 spec
**Package**: adapters
**Branch**: `main`

### Summary

完成 00-bootstrap-guidelines：按实际运行形态重塑 .atw/spec，32 个包全部写入基于源码的中文规范

### Main Changes

- 删除 369 个未填写的 frontend/backend 模板，改为 node / browser / rust 分层
- 新增 guides/typescript-workspace.md 与 guides/rust-workspace.md 作为跨包基准
- 新增 adapters/node 共用约定；15 个 adapter-* 只写各 Harness 特有协议与坑
- 核心包、renderer-extension、5 个 Rust crate 的 spec 均引用真实源码路径

### Git Commits

| Hash | Message |
|------|---------|
| `a2c5b9bb` | docs: 填充 ATW 项目 spec |

### Testing

- [OK] 链接检查 0 失效；约 280 处路径引用逐一核对，27 处未命中均为包内相对路径或构建产物
- [OK] 抽查若干 spec 结论与源码一致；spec 内列出的 vitest/cargo 命令未执行（本机未装依赖）

### Status

[OK] **Completed**

### Next Steps

- 评估是否为 spec 记录的代码问题开任务：mapping-store Delegation 写入未串行、Linux 更新目录不一致、OMP 恢复后 Permission Mode 报告、Hermes real 测试断言过期、contract-audit adapterReason、opencode 缺 zod 依赖声明
- 更新过时文档：.agents/skills/codexhost-add-harness、docs/architecture/harness-executable-discovery.md 等


## Session 2: 品牌替换收尾：品牌守卫、更新提示与 Adapter 改名、移除关于页
<!-- atw-session: v=2 fp=92af8da0666a925e -->

**Date**: 2026-09-25
**Task**: 品牌替换收尾：品牌守卫、更新提示与 Adapter 改名、移除关于页
**Package**: adapters
**Branch**: `main`

### Summary

完成第 06 票品牌守卫（tools/brand-guard.test.mjs，扫描字符串字面量与 README，按文件限定白名单），并修正其拦下的 remote --help 与第三方声明标题；设置页更新失败提示改用 Codex Connect；按用户要求移除设置页关于页与 Star 支持链接（上游署名仅保留在 README 致谢）；Harness Adapter 中用户与 Agent 可见文案改名，守卫扩展至 update-manager、updater 与全部 Adapter。已归档任务 09-25-rebrand-codex-connect。遗留：首次发布（推送、npm Trusted Publisher、v 标签）由维护者完成；claude-code/opencode 两个未安装测试因本机 /opt/homebrew/bin 装有对应工具而失败，与本任务无关。

### Git Commits

| Hash | Message |
|------|---------|
| `74dfa999` | test(brand): 新增品牌守卫测试并修正遗漏的用户可见产品名 |
| `69b82923` | chore(task): 勾选 06 票验收项并回写品牌守卫实现 |
| `217903e6` | fix(update): 设置页更新失败提示改用 Codex Connect 并纳入品牌守卫 |
| `a25b275d` | feat(ui): 设置页移除关于页与 Star 支持链接 |
| `4d875e6a` | fix(adapters): Harness Adapter 的用户与 Agent 可见文案改用 Codex Connect |

### Status

[OK] **Completed**


## Session 3: 会话用量与恢复：新「会话」设置页
<!-- atw-session: v=2 fp=8f2d4e7713304c18 -->

**Date**: 2026-09-26
**Task**: 会话用量与恢复：新「会话」设置页
**Package**: adapters
**Branch**: `token-tracker`

### Summary

实现 09-26-session-usage-browser 全部 7 张工单：原生用量读取产出会话摘要（Claude Code、Codex、Pi、oh-my-pi），Host 新增 codexhost/sessions/query（子代理折叠、按会话计价、已映射标注、Hermes/DSH 导入候选并入），新「会话」页取代「会话导入」页（筛选搜索、分批渲染、恢复与失败面板、复制指令），oh-my-pi 获得会话导入。代码审查后按用户决定：恢复命令移到 Adapter、v2 用量状态迁移保留历史、Pi/oh-my-pi Fork 单独成行、零 Token 会话不列出。真机检查修正未安装 Harness 的误报与 oh-my-pi 技能发起会话的轮数和导入。TypeScript 全量测试仅余两个与本任务无关、依赖本机已装 CLI 的 command.test 失败；恢复与复制指令的人工验证交给用户。

### Git Commits

| Hash | Message |
|------|---------|
| `f7a1484d` | feat(sessions): 新增「会话」设置页，列出 Claude Code 主会话及其用量并可恢复 |
| `94d327a0` | feat(sessions): 会话页接入官方 Codex 会话，子线程折叠进主线程 |
| `852fbb76` | feat(sessions): 会话页接入 Pi 会话，恢复复用 Pi 会话导入 |
| `0cfff635` | feat(sessions): oh-my-pi 获得会话导入，会话页列出 oh-my-pi 会话并可一键恢复 |
| `23f7d156` | feat(sessions): 会话页支持按 Harness、时间范围、项目筛选与搜索，大列表分批渲染 |
| `b420bbc8` | feat(sessions): 会话行提供「复制指令」，粘进终端即可在对应 CLI 中继续 |
| `3ba45d29` | feat(sessions): 「会话」页取代「会话导入」页，并入 Hermes、DSH 可导入的会话 |
| `b036cfb4` | fix(sessions): 按审查结果修正会话页 |
| `6bcafb76` | docs(spec): 会话摘要、会话查询与恢复的可执行契约 |
| `7eed17ff` | fix(sessions): 真机检查修正：未安装的 Harness 不再提示失败，oh-my-pi 技能发起的会话可恢复 |

### Status

[OK] **Completed**
