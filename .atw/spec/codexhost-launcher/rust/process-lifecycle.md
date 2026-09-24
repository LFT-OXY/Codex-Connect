# 进程生命周期与并发

## 启动顺序（`main.rs#launch`）

1. `LaunchOptions::resolve`：显式 `--shim/--node/...` 必须是绝对路径，否则从 `InstalledResources::from_current_executable()` 推导；所有文件都经过 `canonical_existing_file`。
2. `discover_desktop`：`--custom-install` 只在 Windows 生效，其他平台直接报错。
3. `acquire_launcher_ownership`（`desktop_attachment.rs`）：
   - 对 `launcher-v1.lock` 做 `fs2::try_lock_exclusive`；拿到就是 `Acquired(LauncherGuard)`，guard 的 `Drop` 负责解锁。
   - 拿不到时读取运行时描述符，向 `127.0.0.1:<control_port>` 发 `ATTACH <nonce>`。`ready` 表示已附加到正在运行的受管 Desktop，本进程直接成功退出；`busy`、空行、畸形响应、`ConnectionReset/Aborted/TimedOut/WouldBlock` 都按"暂时不可附加"处理；`rejected`、`failed` 直接报错。
   - 重试间隔从 100ms 指数退避到 1s（注释：避免多个 Launcher 对正在恢复的 Controller 造成连接风暴），总超时 120s。
   - 锁冲突判断同时接受 `WouldBlock` 和 `raw_os_error() == Some(33)`（Windows `ERROR_LOCK_VIOLATION`），不要删掉后者。
4. 三态分类 `runtime_instance.rs#classify_startup`：Desktop 在跑 → `Attach`；描述符存在但控制端口不通 → `RecoverStale`；其余 → `CleanLaunch`。只有这三个状态，`tests/cli.rs` 会检查。
5. `allocate_runtime_control`：先 bind 两个 `127.0.0.1:0` 拿到端口再立即释放，作为 Renderer CDP 端口和 Controller attachment 端口，外加 16 字节随机 nonce（32 位小写十六进制）。
6. `supervise_desktop`：启动 Desktop → 启动 Controller 并等待 readiness（120s）→ 等待 Host chain（Desktop 后代里同时出现 Shim 和 Node，30s）→ 发布描述符 → `notify_ready_and_detach`（打印 `ready` 后脱离终端）→ 进入 100ms 监督循环。

启动阶段失败必须在 `notify_ready_and_detach` 之前返回错误，这样调用方看到的是非零退出和 stderr，而不是 `ready`（见函数注释）。

## 各平台差异

| 平台 | Attach 状态的处理 | Desktop 启动方式 | 监督方式 |
|---|---|---|---|
| macOS | `force_stop_desktop` 后 `continue` 重新判定 | `launch_desktop_session` + `DesktopLaunchMode::LaunchServices`（`/usr/bin/open -n -W --env ...`） | `DesktopSession`：每 100ms 查根进程，每 500ms（`DESKTOP_TREE_REFRESH_INTERVAL`）刷新一次完整进程树；退出时 `cleanup_escaped` |
| Windows | 开始菜单启动（`--start-menu`）弹 `prompt_running_desktop` 让用户选重启/重试/取消；否则删掉陈旧描述符并 `force_stop_external_desktop` | `launch_desktop` + `DirectExecutable`，AppX 包走激活 | `DesktopProcess::try_wait`；另有 5s 的 `wait_for_launched_desktop_ownership` 确认根进程就是自己拉起的那个 |
| Linux | 不重试：发现有 Desktop 根进程直接返回 `UnmanagedDesktopConflict`（不接管独立运行的 ChatGPT，见 `docs/platforms/linux/linux.md`） | `launch_desktop_session` + `DirectExecutable` | 与 macOS 相同的 `DesktopSession` 循环 |

- `RecoverStale` 遇到无法解析的描述符：macOS/Windows 直接删除文件；Linux 返回错误要求用户先核对归属再删除，不自动删。
- `force_stop_external_desktop`（Windows）在终止前逐个比对进程可执行文件，身份变化时拒绝终止；`stop_stale_launcher` 只在 Windows 实际终止旧 Launcher，且要求可执行文件与当前 exe 相同，其他平台是 no-op。
- 描述符目录：macOS `~/Library/Application Support/codexhost/`，Windows `%LOCALAPPDATA%\codexhost\`，Linux 走 `secure_storage::runtime_directory()`（`$XDG_RUNTIME_DIR/codexhost`，否则 `$XDG_STATE_HOME` 或 `~/.local/state` 下的 `codexhost`）。锁文件和 `updates/` 目录都放在描述符旁边。

## 描述符与锁的写入规则

- `write_descriptor`：先写同目录临时文件 `.desktop-runtime-v1.json.<pid>.<nonce>.tmp`，`sync_all` 后原子替换（非 Linux 用 `codexhost_platform::atomic_replace_file`，Linux 用 `replace_secure_file`）；失败时删除临时文件。
- `remove_matching_descriptor` 只删除内容与自己发布的完全相同的描述符。Linux 版本会保持文件打开直到 unlink，并按 inode 校验，防止并发替换后误删新 owner 的文件（注释原文："a concurrent replacement cannot turn cleanup into deletion of another file"）。
- `RuntimeDescriptorGuard` 在 `Drop` 时执行匹配删除；监督循环里用 `let _runtime = publish_runtime_descriptor(...)` 持有它，不要改成 `let _ =`（那样会立即 drop 并删除描述符）。
- Linux 下所有运行时文件必须经由 `secure_storage.rs`：拒绝符号链接、忽略 umask、目录 `0700`。测试 `linux_runtime_files_ignore_umask_and_stay_private`、`linux_runtime_descriptor_and_guard_reject_symlinks` 覆盖这些规则。

## 子进程停止

- Controller 用 `spawn_supervised` 启动（platform 的进程组/Job 监督）。`stop_desktop_controller`：先 `terminate()`，1s（`CONTROLLER_STOP_GRACE`）内未退出就 `force_terminate()`，最后 `disarm_cleanup()`。
- 正常退出路径必须调用 `disarm_cleanup()`，否则 guard 的 `Drop` 会再发一次 SIGKILL。
- Controller 在 Desktop 运行中退出视为错误：macOS/Linux 关闭 Desktop 后返回错误；Windows 先给 Desktop 1s 自行退出。

## 为更新退出（`active_update.rs`）

- 每轮监督循环调用 `should_stop_desktop_for_update`：当 `updates/active-update-v1.lock` 指向的 `status-v1.json` 处于 `waiting-for-exit`，且对应 `request-v1.json` 的 `wait_pid`/`wait_executable` 正是本 Launcher 时，停止 Controller 和 Desktop 并正常返回，让 Updater 接手。读失败只记日志、不退出。
- 仅 macOS：状态为 `prepared` 时由 Launcher 自己用 `process_group(0)` 拉起操作目录里的 `codexhost-updater apply --request <path>`，把锁文件原子改写成 `ownerPid = updater pid`，再等 Updater 写出 `waiting-for-exit`（10s）；失败则杀掉 Updater。其他平台由 Host Runtime 直接启动 Updater（`packages/host-runtime/src/update-coordinator.ts`：`if (platform !== "darwin") manager.start(prepared)`）。
- 所有更新状态文件都按"不是符号链接的普通文件、≤ 4 KiB"读取，状态目录必须是 `update-*` 且位于 `updates/` 下，否则返回 `InvalidData`。
