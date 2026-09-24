# codexhost-platform（rust）

`codexhost-platform` 是 workspace 中唯一的 Rust 库，集中提供 Launcher、Shim、Updater 和 Gate A 探针共用的原生能力：官方 Codex Desktop 安装发现、受管 Desktop 启动、按进程实例（PID + 启动时间）观察和终止进程树、子进程监督（Unix 进程组 / Windows Job）、代理环境解析、原子文件替换、macOS 原生 Harness broker LaunchAgent 管理，以及 Windows 对话框。它不包含 Host 协议或 Thread 语义。

## 依赖与边界

- `Cargo.toml`：通用依赖只有 `serde`、`sha2`。Unix 加 `nix`；Linux 加 `rustix`（pidfd）、`serde_json`；macOS 加 `libproc`、`plist`、`system-configuration`；Windows 加 `windows` crate（AppX、WinHTTP、COM、控制台、UI 等 feature）。
- 上游消费者：`crates/launcher`、`crates/shim`、`crates/updater`、`tools/gate-a/native`（通过 `gate-tools` feature）。修改公开 API 时要编译全部四个。
- 所有公开符号都从 `src/lib.rs` 用显式 `pub use` 导出，且大量导出本身就带 `#[cfg]`。新增导出要写在 `lib.rs` 对应位置，并说明在哪些平台可用。

## 模块地图

| 模块 | 平台 | 职责 |
|---|---|---|
| `lib.rs` | 全部 | `PlatformError`、`DesktopInstallation`/`DesktopIdentity`、`DesktopLaunchMode`、环境变量名常量、`atomic_replace_file`、`canonical_existing_file`、`node_entrypoint_path`、`validate_proxy_target` |
| `process.rs` | 全部（大部分 Unix） | `ProcessSnapshot`、全机快照、`ObservedProcessTree`、Desktop 根/后代识别、macOS `force_stop_desktop` |
| `macos_process_observation.rs` | macOS | 缩小需要读取可执行路径的候选集（性能优化，见 `docs/platforms/macos/macos-process-observation.md`） |
| `process_observation_tests.rs` | macOS 测试 | 用 `#[path]` 挂到 `process.rs` 下，以全量快照做对照 |
| `process_supervision.rs` | 全部 | `spawn_supervised` / `SupervisedChild` / `ChildProcessGuard` |
| `process_termination.rs` | 全部 | `terminate_process_instance`、`terminate_process_group_instance` |
| `desktop_launch.rs` | 全部 | 受管/原版 Desktop 启动命令、`DesktopSession`（Unix）、`open_external_url` |
| `installation.rs` / `linux_installation.rs` | Win+macOS / Linux | Desktop 安装发现与校验 |
| `background.rs` | 全部 | `detach_from_terminal`、Linux `start_in_new_session` |
| `proxy_environment.rs`、`system_proxy.rs`、`windows_proxy.rs` | 全部 / macOS / Windows | 子进程代理环境 |
| `macos_native_harness_broker.rs` | 规划函数全平台编译，执行函数仅 macOS | LaunchAgent plist 规划、`launchctl` 执行 |
| `windows_process.rs`、`windows_desktop.rs`、`windows_ui.rs` | Windows | 手写 FFI（Toolhelp、Job Object、MoveFileEx）、AppX 激活、TaskDialog/MessageBox |

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [process-model.md](./process-model.md) | 改进程快照、树归属、信号/终止、`spawn_supervised`、Job Object 时 |
| [platform-integration.md](./platform-integration.md) | 改安装发现、Desktop 启动与环境注入、代理、broker、Windows UI、`unsafe` 或 cfg 组织时 |

## 已知技术债（照实记录，不要扩散）

- `desktop_launch.rs`（约 1500 行）、`installation.rs`（约 1150 行）、`process.rs`（约 1120 行）、`macos_native_harness_broker.rs`（约 1050 行）都已超过 800 行。新能力按平台或职责新建模块（参照 `linux_installation.rs`、`macos_process_observation.rs` 的拆法）。
- `macos_native_harness_broker.rs` 保留了 Claude Code 专属的历史语义：`harness_id == "claude-code"` 时使用旧 Label `ai.bytepioneer.codexhost.native-harness-broker`，且 `ProgramArguments` 不带 Harness ID（注释："Keep the legacy Claude command line byte-for-byte compatible"）。其他 Harness 用通用规则，不要再加 Harness 特判。
- `CUSTOM_INSTALL_ROOT_ENV` 和 Gate A 的 `INSTALL_ROOT_ENV` 是同一个变量名 `CODEXHOST_INSTALL_ROOT`；Gate 探针会把它设为已发现的安装根。

## 改动前检查清单

1. 新增平台逻辑时，其余平台要么返回 `PlatformError::Unsupported("...")`，要么是明确的 no-op（例如非 Windows 的 `configure_background_command`）；文件末尾常见 `#[cfg(not(any(windows, macos, linux)))]` 兜底实现，保持这个模式。
2. 任何"终止/发送信号"操作前都要重新确认进程实例（`same_process_instance`：PID + `started_at_micros`），不能只凭 PID。
3. 不要缓存可执行路径：合法 `exec` 会在 PID 和启动时间不变时改变路径（macOS 观察文档的"不缓存路径"条款）。
4. `unsafe` 只允许出现在 `windows_*` 模块和 Windows 版 `background.rs`：`lib.rs` 顶部是 `#![deny(unsafe_code)]`，这些模块单独 `#[allow(unsafe_code)]`。Unix 侧用 `nix`/`rustix` 的安全封装。
5. 改 `lib.rs` 的 `pub use` 后，编译所有消费者：`cargo build --locked --workspace --features codexhost-gate-a-native/gate-tools`。
6. 定向测试：`cargo test -p codexhost-platform --locked`；改进程观察或监督时加跑 `cargo test --locked -p codexhost-platform -p codexhost-shim -p codexhost-launcher --features codexhost-shim/test-utils`（真实生命周期测试在 shim 里）。
