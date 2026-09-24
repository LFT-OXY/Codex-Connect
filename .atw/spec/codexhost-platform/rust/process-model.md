# 进程模型：身份、归属与终止

## 进程实例身份

- `ProcessSnapshot { id, parent_id, process_group_id, executable, started_at_micros }` 是全 crate 的进程标识。**进程实例 = PID + `started_at_micros`**（`same_process_instance`），可执行路径不是身份的一部分。
- 快照来源：macOS 用 `libproc`；Linux 读 `/proc/<pid>/stat`（启动时间按 `CLK_TCK` 换算，缓存在 `LINUX_CLOCK_TICKS_PER_SECOND`）；Windows 用 Toolhelp 快照 + `GetProcessTimes`（`windows_process.rs`），没有进程组概念，`process_group_id` 直接填 PID，不要在 Windows 路径上依赖它。
- 调用方把 `PlatformError::NotFound` 当作"进程已退出"，据此 `continue` 或返回 `Ok`。注意各平台映射不同：macOS `libproc` 的任何查询失败都映射为 `NotFound`；Windows 的 `OpenProcess`/`GetProcessTimes` 失败映射为 `ProcessInspection { process_id, operation, source }`，保留原始 OS 错误码，Shim 的 `process_identity.rs` 依赖这些错误码（5/31/87）区分"暂时不可查"和"已退出"。新增查询时沿用这一约定，不要把 Windows 错误吞成 `NotFound`。

## `ObservedProcessTree`（Unix，`process.rs`）

维护一个"已归属的存活进程账本" `known`：

- 根进程是严格锚点：同一 PID 的启动时间变化就报 `"PID {} was reused while observing the process tree"`。根的可执行文件变化默认也报错（`RootExecutablePolicy::Fixed`）；`new_following_root_exec` 允许根在同一进程实例内 `exec` 成别的程序（用于 shebang 脚本或 Node 入口）。
- 后代：从账本里的 PID 沿 `parent_id` 向下发现；已退出的后代会从账本中移除，之后复用了同一 PID 的无关进程只有在仍能从存活树追溯到时才会被重新纳入（测试 `forgets_a_retired_descendant_when_its_pid_is_reused`、`readopts_a_reused_descendant_pid_only_through_current_lineage`）。
- 进程组成员：设置了 `process_group_id` 时，同 PGID 且启动时间不早于组创建时间的进程也算归属，用来追踪 `setsid`/重挂到 PID 1 的后代。Linux 还额外拒绝"加入受管进程组、却无法从根或账本追溯"的外来进程，直接报错而不是静默接管。
- `escaped()`：已归属但已不在根后代链上的进程（例如父进程已退出而被重新挂接的进程），供 `DesktopSession::cleanup_escaped` 清理。

## 发送信号前再核对一次

`signal_processes` 对每个目标重新取快照、核对进程实例，然后才发信号：

- Linux：先 `pidfd_open`，再核对快照，最后 `pidfd_send_signal`。持有 pidfd 保证核对与发信号之间 PID 不会被复用（测试 `pidfd_signal_targets_the_observed_process_instance`）。
- macOS：核对快照后调用 `kill`；`ESRCH` 视为已退出。
- 核对失败（PID 被复用）返回 `Invalid("PID {} was reused before signal delivery")`，**不要**降级成"跳过并继续"。

`process_termination.rs` 提供一次性的精确终止：`terminate_process_instance` 只终止一个实例；`terminate_process_group_instance` 在 Unix 上只终止与根同 PGID 且启动时间不早于根的成员，在 Windows 上等价于单进程终止（Windows 通过 `terminate_process_instance(pid, started_at, code)` 在句柄上再核对启动时间，测试 `refuses_to_terminate_a_reused_windows_process_id`）。

## `spawn_supervised` / `SupervisedChild`

| | Unix（macOS/Linux） | Windows |
|---|---|---|
| 归属机制 | `Command::process_group(0)`，要求子进程成为组长（`PGID == PID`），否则杀掉并报错 | 创建 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的 Job 并把子进程加入（`windows_process::guard_child`） |
| 启动身份确认 | `spawned_root_snapshot` 在 1s 内等子进程 `exec` 成预期可执行文件；shebang 脚本（文件以 `#!` 开头）不做路径校验，因为实际进程是解释器 | 加入 Job 失败时，如果子进程已退出则不挂 guard，否则报错 |
| `terminate()` | 对进程组 `SIGTERM`，并对逃出进程组的已归属成员逐个 `SIGTERM` | `TerminateJobObject` |
| `force_terminate()` | 同上但用 `SIGKILL` | 同 `terminate()` |
| `Drop` | `armed` 时对全部已归属成员 `SIGKILL` | Job 句柄关闭，系统杀掉 Job 内全部进程 |

- `ChildProcessGuard` 在 Unix 上用 `std::sync::Mutex<ObservedProcessTree>` 保护账本，锁中毒时返回 `Invalid("supervised process identity lock was poisoned")`，不 panic。
- `wait_for_tree_exit`：根进程退出不代表整棵树结束，必须同时确认 `has_live_processes()` 为假。
- `disarm_cleanup()` 只影响 Unix 的 Drop 行为。调用方在已确认树退出后必须调用它，避免 Drop 时误伤（Launcher 的 `stop_desktop_controller` 就是这样做的）。
- `forward_signal` 仅 Unix，Shim 用它把收到的 SIGTERM/SIGINT/SIGHUP 转发给整棵受管树。

## Desktop 进程识别

- Unix：`desktop_process_tree` 以 `installation.desktop_executable` 精确匹配的进程为根（父进程不是同一可执行文件），再加上全部后代。`desktop_root_process_ids_for_installation` 只返回根。
- Windows：`desktop_process_ids` / `desktop_root_process_ids` 基于 Toolhelp 列表，路径比较前先做 `\\?\` verbatim 前缀归一化并转小写（测试 `treats_verbatim_and_regular_windows_executable_paths_as_equal`）。
- `descendant_executable_exists(pid, path)` 用于 Launcher 等待 Host chain：Desktop 后代中出现 Shim 和 Node 才算就绪。

## 性能约束

- macOS 的 `ObservedProcessTree::observe` 通过 `macos_process_observation::tree_snapshots` 只为候选进程读取可执行路径；候选可以多选，但不能漏选。改这里之前先读 `docs/platforms/macos/macos-process-observation.md`，并跑 `process_observation_tests.rs` 的对照测试。
- 降低 CPU 占用不能靠降低观察频率或放宽身份检查（同一文档的"目的与范围"）。现有节流只有两处：Launcher 500ms 一次完整树刷新、Shim 在 Linux 上 500ms 一次（macOS 20ms）。
