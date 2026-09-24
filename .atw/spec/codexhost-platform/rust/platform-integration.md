# 平台集成：发现、启动、代理与 cfg 组织

## cfg 组织方式

- 整个模块只属于一个平台时，在 `lib.rs` 的 `mod` 声明上加 `#[cfg]`（`linux_installation`、`macos_process_observation`、`system_proxy`、`windows_*`）。
- 同名函数分平台实现时，按 `windows` / `macos` / `linux` / 兜底 `not(any(...))` 的顺序并列写在同一文件里（`process.rs` 的 `desktop_process_ids_for_installation`、`parent_process_id` 等）。
- 纯计算、可跨平台测试的部分不加 cfg，只把副作用函数限定到目标平台：`macos_native_harness_broker.rs` 的 `plan_*`、`native_harness_broker_label` 全平台编译并测试，`install_/inspect_/stop_/uninstall_native_harness_broker` 只在 macOS。新增平台能力时优先这样拆，便于在任何 CI 平台上测试规划逻辑。
- Windows 专属的手写 FFI 放在 `windows_process.rs`（`extern "system"` 声明 Toolhelp、Job、`MoveFileExW`），能用 `windows` crate 的地方用 crate（`windows_desktop.rs`、`windows_proxy.rs`、`windows_ui.rs`）。

## 安装发现

| 平台 | 入口 | 规则 |
|---|---|---|
| Windows | `installation.rs#discover_codex_desktop` | 顺序：`CODEXHOST_PROBE_*` 六个变量（必须全部提供或全部缺省，否则报错，Gate A 专用）→ `CODEXHOST_INSTALL_ROOT` 便携安装根 → AppX `PackageManager` 查 `OpenAI.Codex`。`discover_codex_desktop_from_root` 处理 `--custom-install` |
| macOS | 同上 | 只看 `/Applications` 和 `~/Applications` 下的 `Codex.app`、`ChatGPT.app`；Bundle ID 必须是 `com.openai.codex`，可执行文件校验 Mach-O 魔数，计算 asar 完整性；有效候选恰好一个才成功，多个直接报错 |
| Linux | `linux_installation.rs#discover_codex_desktop` | 固定 `/usr/bin/chatgpt`、`/usr/lib/chatgpt`；校验包元数据和当前架构的 64 位 ELF（x86_64 / aarch64）。不支持 Snap/Flatpak/AppImage 等（`docs/platforms/linux/linux.md`） |

`discover_desktop_managed_codex_cli`（Windows/macOS）只从已校验的 Desktop 安装中取官方 CLI，**绝不搜索 PATH**；显式安装根即使无效也以它为准（函数注释）。Shim 的 helper 回退路径依赖这条规则。

## 受管 Desktop 启动（`desktop_launch.rs`）

- `managed_desktop_environment` 固定注入 `CODEX_CLI_PATH=<canonical Shim>` 和 `CODEXHOST_STOCK_CODEX_PATH=<installation.executable_codex_cli>`，再追加调用方给的环境。Windows 上如果 Shim 旁有 `codexhost-node-repl.exe`，还会设置 `CODEX_NODE_REPL_PATH`。
- 原版 Desktop（`launch_stock_desktop`）会移除继承的 `CODEX_CLI_PATH` 和所有 `CODEXHOST_*` 变量（Windows 还有 `CODEX_NODE_REPL_PATH`），保证用户退出 codexhost 后打开的是原版行为。
- 继承环境带 `CODEXHOST_REMOTE_SSH_MANAGED=1` 时，移除仅属于远程 profile 的 `CODEX_INSTALL_DIR`、`CODEXHOST_DATA_DIR`、`CODEXHOST_REMOTE_SSH_MANAGED`。
- 启动方式：
  - macOS `LaunchServices`：`/usr/bin/open -n -W --env K=V ... <bundle> --args ...`。环境变量只能是 UTF-8，否则返回 `Invalid`。`DirectExecutable` 则直接执行并 `process_group(0)`。
  - Linux：只支持 `DirectExecutable`，直接执行 Desktop 可执行文件（不经官方 wrapper），并用 `start_in_new_session` 让它成为无控制终端的新会话组长，避免交互 shell 触发 SIGTTIN/SIGTTOU 挂起整个组（`background.rs` 注释）。
  - Windows：有 AppX 身份时走 `activate_packaged_desktop`。它通过 `IPackageDebugSettings::EnableDebugging` 临时给包注入环境块，并把 `codexhost.exe --codexhost-resume-appx-thread` 注册为"调试器"；AppX 以挂起状态启动主线程并调用该命令，`resume_packaged_application` 校验 `-p <pid> -tid <tid>` 后恢复线程。启动前先清理上次残留的调试注册（Launcher 被强杀时会残留）。无 AppX 身份（便携安装）时直接 spawn `desktop_launcher`。
- `launch_desktop_session`（Unix）在已有 Desktop 进程树时拒绝启动（"refusing to reuse or terminate it"）；Linux 还会在启动窗口内确认新根进程确实是自己拉起的，出现无法归属的 Desktop 根时返回 `PlatformError::UnmanagedDesktopConflict`。

## 代理环境

- `proxy_environment()`：显式环境变量永远优先。macOS 用 `system-configuration` 读取静态系统代理补齐缺失项（自动代理配置无法表达为环境变量，只打印警告）；Linux 不读系统代理（环境变量和 TUN 方案才是权威）；Windows 这个函数不读系统代理。
- `desktop_helper_proxy_environment()` 仅 Windows：Desktop 工具 helper 可能保留 `CODEX_CLI_PATH` 却丢了代理变量，只在 helper 路径上用 WinHTTP 当前用户静态代理补齐；显式值（包括空值）优先。
- 代理值写进 LaunchAgent plist 时（broker），带 `@` 的代理 URL 会被拒绝，禁止持久化代理凭据；只允许 9 个代理相关变量名。

## 其他共享工具

- `atomic_replace_file`：Unix 是 `rename`；Windows 是带重试（2s 内每 10ms）的 `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)`，用于应对短暂的共享冲突。所有"写临时文件再替换"的调用方（Launcher 描述符、Updater 状态、Shim 所有者记录）都应走它。
- `node_entrypoint_path`：Windows 上把 `\\?\C:\...` 和 `\\?\UNC\...` 规范成 Node 能接受的路径；传给 Node 的脚本路径都要先经过它。
- `validate_proxy_target(shim, target)`：拒绝目标解析回 Shim 自身，防止递归代理。
- `detach_from_terminal`：Unix `setsid` 并把标准流重定向到 `/dev/null`；Windows 忽略控制台控制事件。只能在启动完成后调用，启动期的 Ctrl+C 仍需能中止启动。
- Windows UI（`windows_ui.rs`）：`prompt_running_desktop` 使用 TaskDialog，按用户区域设置在中英文文案间选择；`show_error_dialog` 用 MessageBox。

## 测试手法

- 需要"另一个进程"时，重新执行当前测试二进制：`Command::new(current_exe()).args(["--exact", TEST_NAME]).env(MODE, "...")`，子进程读到环境变量后走辅助分支（`background.rs` 的 `CODEXHOST_DETACH_HELPER`、`process_supervision.rs` 的 `CODEXHOST_TEST_JOB_ACCOUNTING`、`desktop_launch.rs` 的 `CODEXHOST_TEST_APPX_NODE_REPL_ENV`）。新测试沿用这个模式，不要额外引入测试二进制。
- 安装发现测试在临时目录里构造假 bundle / 假 ELF / 假便携目录（`installation.rs` 的 `temporary_bundle`、`portable_fixture`，`linux_installation.rs` 的 `fixture`）。
- 平台测试都带 `#[cfg(all(test, target_os = "..."))]`，本地只会跑宿主平台；其余平台依赖 CI。
