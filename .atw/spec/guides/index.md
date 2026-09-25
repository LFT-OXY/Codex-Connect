# Thinking Guides

> **Purpose**: Expand your thinking to catch things you might not have considered.

---

## Why Thinking Guides?

**Most bugs and tech debt come from "didn't think of that"**, not from lack of skill:

- Didn't think about what happens at layer boundaries → cross-layer bugs
- Didn't think about code patterns repeating → duplicated code everywhere
- Didn't think about edge cases → runtime errors
- Didn't think about future maintainers → unreadable code

These guides help you **ask the right questions before coding**.

---

## 项目通用约定

各包的 spec 默认以下列约定为基础，只补充本包特有的规则。

| 文档 | 适用范围 |
|------|----------|
| [TypeScript Workspace 通用约定](./typescript-workspace.md) | `packages/*`、`packages/adapters/*`：包结构、导入、zod 契约、错误形态、测试和验证命令 |
| [Rust Workspace 通用约定](./rust-workspace.md) | `crates/*`、`tools/gate-a/native`：职责边界、`PlatformError`、平台分支、测试 |

各包 spec 位于 `.atw/spec/<package>/<layer>/`。层名按实际运行形态划分：`node`（Node.js 包）、`browser`（renderer-extension）、`rust`（Rust crate）。

---

## Available Guides

| Guide | Purpose | When to Use |
|-------|---------|-------------|
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md) | Identify patterns and reduce duplication | When you notice repeated patterns |
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | Think through data flow across layers | Features spanning multiple layers |

---

## Quick Reference: Thinking Triggers

### When to Think About Cross-Layer Issues

- [ ] Feature touches 3+ layers (API, Service, Component, Database)
- [ ] Data format changes between layers
- [ ] Multiple consumers need the same data
- [ ] You're not sure where to put some logic
- [ ] You are adding an event kind, JSONL record, RPC payload, or config field
- [ ] UI / command code starts casting raw payload fields directly

→ Read [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md)

### When to Think About Product Naming（品牌守卫）

- [ ] 新增或修改面向用户的文案：本地化、设置页、Harness 安装引导、CLI 帮助与委派提示、发布脚本产物、Rust 弹窗与 usage、会写进更新状态的失败原因（设置页原样显示）、README
- [ ] 合并上游之后
- [ ] 新增带 `codexhost` 字样的内部标识（CSS 类名、临时目录前缀、内部二进制、诊断前缀）

→ 运行 `npx vitest run --config tests/vitest.config.js tools/brand-guard.test.mjs`。
- 面向用户的文字写 `Codex Connect`，npm 命令写 `codex-connect`。上游地址 `BytePioneer-AI/codex-host` 只能作为署名出现，且只在"关于"页和 README 致谢中各一处。
- 守卫只扫描字符串字面量和 README，跳过注释与 Rust 的 `#[cfg(test)]`/`#[cfg(all(test, …))]` 项。
- 如果内部标识被误报，就在 `ALLOWED_INTERNAL_NAMES` 里加一条规则，写明 `reason`。只要这个形状可能出现在文案里，就用 `files` 把规则限定在它实际出现的文件上。不要放宽已有的规则去覆盖文案文件。
- 新增面向用户文案的文件时，把它加进 `SCANNED_FILES`。

### When to Think About Code Reuse

- [ ] You're writing similar code to something that exists
- [ ] You see the same pattern repeated 3+ times
- [ ] You're adding a new field to multiple places
- [ ] **You're modifying any constant or config**
- [ ] **You're creating a new utility/helper function** ← Search first!
- [ ] Two files read the same untyped payload field with local casts
- [ ] Multiple branches update the same derived state from `kind` / `action`

→ Read [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md)

### When Verifying AI Cross-Review Results

- [ ] Reviewer claims "user input can be malicious" → Check the actual data source (internal manifest? user config? external API?)
- [ ] Reviewer flags "missing validation" → Is the data from a trusted internal source?
- [ ] Reviewer says "behavior change" → Read the code comments — is it intentional design?
- [ ] Reviewer identifies a "bug" in test → Mentally delete the feature being tested — does the test still pass? If yes → tautological test

**Common AI reviewer false-positive patterns**:
1. **Trust boundary confusion**: Treating internal data (bundled JSON manifests) as untrusted external input
2. **Ignoring design comments**: Flagging intentional behavior documented in code comments as bugs
3. **Variable misreading**: Not tracing a variable to its actual definition (e.g., Map keyed by path vs name)

**Verification rule**: Every CRITICAL/WARNING finding must be verified against the actual code before prioritizing. Budget ~35% false-positive rate for AI reviews.

---

## Pre-Modification Rule (CRITICAL)

> **Before changing ANY value, ALWAYS search first!**

```bash
# Search for the value you're about to change
grep -r "value_to_change" .
```

This single habit prevents most "forgot to update X" bugs.

---

## How to Use This Directory

1. **Before coding**: Skim the relevant thinking guide
2. **During coding**: If something feels repetitive or complex, check the guides
3. **After bugs**: Add new insights to the relevant guide (learn from mistakes)

---

## Contributing

Found a new "didn't think of that" moment? Add it to the relevant guide.

---

**Core Principle**: 30 minutes of thinking saves 3 hours of debugging.
