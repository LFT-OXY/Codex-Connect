# Rust Workspace 通用约定

> 适用于 `crates/*` 和 `tools/gate-a/native`。各 crate 的 spec 只写本 crate 特有的内容。

## 职责边界

Rust 负责原生启动、进程管理、更新安装和平台集成，不承担 Host 协议或 Harness 语义（见 `AGENTS.md` Boundary Rules）。出现协议解析、Thread 映射或 Harness 行为判断时，应该放到 TypeScript 包里。

## Workspace

- 根 `Cargo.toml`：`edition = "2024"`，`resolver = "3"`，`rust-version = "1.97.1"`，`publish = false`。版本号统一由 `[workspace.package]` 管理。
- 工具链固定在 `rust-toolchain.toml`（1.97.1，自带 clippy 和 rustfmt），没有自定义 rustfmt/clippy 配置。
- 成员：`launcher`、`platform`、`shim`、`updater`，外加 `tools/gate-a/native`（不在 default-members 中）。
- `codexhost-platform` 是唯一的共享库，其他 crate 通过 `path = "../platform"` 依赖它。可复用的平台能力放进 platform，不要在各二进制 crate 里重复实现。
- 依赖尽量少。跨平台依赖只有 `serde`/`serde_json`、`sha2`、`fs2`、`getrandom`。系统调用走平台 crate 的安全封装，按 target 声明：Unix 用 `nix`，Linux 另加 `rustix`，macOS 用 `libproc`、`plist`、`system-configuration`，Windows 用 `windows`。新增依赖要有明确理由。
- `unsafe` 受限：`codexhost-platform` 在 `lib.rs` 里 `#![deny(unsafe_code)]`，只有 Windows 模块单独 `#[allow(unsafe_code)]`，详见 `.atw/spec/codexhost-platform/rust/index.md`。

## 错误处理

- 不使用 `anyhow` / `thiserror`。平台层统一返回 `Result<_, PlatformError>`（`crates/platform/src/lib.rs`），它是手写的枚举，自己实现 `Display`，带上下文的变体用具名字段，例如 `ProcessInspection { process_id, operation, source }`。
- 二进制入口和局部校验里可以用 `Result<_, String>`，但错误要在入口统一转成退出码和 stderr 输出。
- 面向用户的错误文案要说明用户该怎么做，例如 `UnmanagedDesktopConflict` 的提示语。

## 日志

- 没有日志框架，只用 `eprintln!`，前缀固定为 `codexhost <component>: ...`。启动阶段的耗时埋点格式是 `[codexhost startup +{elapsed}ms] launcher: {stage}`（见 `crates/launcher/src/main.rs`）。
- 不要把 token、认证路径的内容或完整环境变量打到 stderr。

## 平台分支

- 平台差异用 `#[cfg(target_os = "...")]`（全仓约 350 处），或者拆成按平台命名的模块，例如 `platform/src/windows_process.rs`、`macos_process_observation.rs`、`linux_installation.rs`。
- 平台专属依赖写在 `[target.'cfg(...)'.dependencies]` 下。
- 新增平台逻辑时，其他平台要么显式返回 `PlatformError::Unsupported`，要么有明确的 no-op，不要留下编译不通过的分支。

## 测试

- 单元测试放在同文件的 `#[cfg(test)] mod tests`，或者独立的 `*_tests.rs` 模块（例如 `platform/src/process_observation_tests.rs`）。
- 集成测试放在 `crates/<crate>/tests/*.rs`；测试用的假二进制通过 feature 开启（`codexhost-shim/test-utils` 对应 `fake-codex-cli`）。
- 定向运行：`cargo test -p <crate> --locked`；shim 需要加 `--features codexhost-shim/test-utils`。

## 验证命令

- `npm run check:rust`：依次运行 `cargo fmt --check`、`clippy -D warnings` 和 workspace 测试（含所需 features）。
- `npm run build:rust`：只构建四个产品 crate。
