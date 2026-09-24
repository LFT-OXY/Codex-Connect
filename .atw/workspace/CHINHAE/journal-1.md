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
