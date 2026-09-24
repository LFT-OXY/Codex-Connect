# 路由、转发与退出

## 入口分发（`lib.rs#run_from_environment`）

1. Unix：第一个参数是 `--codexhost-remote-terminate` → `remote_lifecycle::run_terminate`（参数 `stock|managed --socket <p> --stock-codex <p> --node <p> --host-runtime <p>`，由 `packages/host-runtime/src/remote-host-lifecycle.ts` 调用，成功时 stdout 打印 `terminated_pid=<pid>`）。
2. Unix：`CODEXHOST_REMOTE_SSH_MANAGED=1` 且参数是默认 Unix listener 形态时：
   - 若没有 `CODEXHOST_REMOTE_LISTENER_CHILD=1`，由 `launch_detached_remote_listener` 以自身重新执行一次（加上该变量），等 `$CODEX_HOME/app-server-control/app-server-control.sock` 被替换且可连接后返回 0；已有一个属于已安装运行时的 socket owner 时直接复用。
   - 子进程先 `setsid` 脱离会话，再走普通代理流程。
3. 其余情况进入 `run_proxy`。

## 官方 CLI 定位（`resolve_stock_codex_path`）

- 优先使用 `CODEXHOST_STOCK_CODEX_PATH`（Launcher 注入）。
- 缺失时只有 Windows/macOS 有回退：要求 `CODEX_CLI_PATH` 恰好指向正在运行的 Shim 本身（Desktop helper 只保留了这个标准覆盖），再用 `discover_desktop_managed_codex_cli` 从已校验的 Desktop 安装取官方 CLI。macOS 的 `node_repl` 在清空两个 CLI 变量后以顶层 `sandbox` 调用 Shim，此时允许不带 `CODEX_CLI_PATH` 回退，其他命令不允许（测试 `macos_browser_sandbox_fallback_rejects_unrelated_commands`）。
- Linux 没有回退，缺失即报错。

## 是否启动 Host Runtime

`child_command` 在同时满足以下条件时启动 `<node> <host-runtime> <原参数...>`，否则执行官方 CLI：

- 不是 Desktop helper：`desktop_invocation::is_desktop_helper`。Windows 通过祖先链判断（Launcher → Desktop → Shim 是主调用，更深的是 helper，最多追溯 32 层，并用启动时间识别父 PID 复用）；macOS 因为 LaunchServices 会把 Desktop 挂到 launchd 下，改为匹配已校验 bundle 里的 Desktop 可执行文件；Linux 恒为 false。
- `should_start_host_runtime(arguments)`：`app-server` 必须是跳过已知全局选项后的第一个子命令（`app_server_subcommand_index`，后面参数里出现的同名字符串不算）；`app-server proxy`/`daemon` 等管理命令保持走官方 CLI（SSH 传输靠 `app-server proxy` 做字节桥接，换成 JSONL Host Runtime 会破坏 WebSocket）；Skysight 记忆摘要（`openai-memgen` provider）和带 `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` 的官方辅助 app-server 也保持官方 CLI。
- `CODEXHOST_HOST_NODE_PATH` 与 `CODEXHOST_HOST_RUNTIME_PATH` 必须同时存在或同时缺失，只给一个直接报错。Launcher 管理的进程（存在 `CODEXHOST_LAUNCHER_PID`）如果同时有 `CODEXHOST_NPM_NODE_PATH` 和 `CODEXHOST_NPM_PACKAGE_ROOT`，改用 `<package_root>/app/host-runtime.mjs`（`select_host_paths`，测试 `local_launcher_paths_win_over_remote_profile_bootstrap_paths`）。

启动 Host Runtime 时设置 `CODEXHOST_STOCK_CODEX_PATH`、`CODEXHOST_HOST_NODE_PATH`、`CODEXHOST_HOST_RUNTIME_PATH`（都已规范化），移除 `CODEX_CLI_PATH` 和远程专用变量；继承自远程 profile 时再移除 `CODEXHOST_DATA_DIR`。

执行官方 CLI 且是 Desktop helper 时，移除全部 `CODEXHOST_*` 变量（注释："Do not pass launcher/runtime credentials or npm routing back into the stock helper's descendants"）。

代理：远程受管模式注入 `proxy_environment()`；Windows helper 或没有 `CODEXHOST_STOCK_CODEX_PATH` 的调用注入 `desktop_helper_proxy_environment()`。

## 转发与等待

- 子进程通过 `spawn_supervised` 启动，stdin/stdout/stderr 各一个线程用 16 KiB 缓冲 `copy_stream`，每块都 `flush`，保证分块边界和响应先于 stdin EOF 送达（测试 `preserves_arbitrary_bytes_and_chunk_boundaries`、`forwards_response_before_stdin_eof`）。
- Unix `wait_for_child` 每 20ms 轮询一次；进程树完整刷新的间隔 macOS 为 20ms，Linux 为 500ms（注释说明 Linux 是为了修复实测的空闲 CPU 回退），根进程退出时立即刷新。
- 终止升级顺序：收到 SIGTERM/SIGINT/SIGHUP → `forward_signal` 给整棵树；根退出但后代仍在 → `terminate()`；本机 Host Runtime 收到 Desktop stdin EOF → `terminate()`。任一情况 2s（`TERMINATION_GRACE`）后仍未结束则 `force_terminate()`，只升级一次。
- Windows 版只观察根进程退出和 stdin EOF，后代清理交给 Job Object。
- 信号只安装一次（`ShutdownSignals`），多个信号到达只转发第一个（测试 `converges_once_when_multiple_shutdown_signals_arrive`）。

## 退出码映射

| 情况 | 退出码 | stderr |
|---|---|---|
| 子进程正常退出 | 子进程的 `code()` | 无 |
| 子进程被信号终止（Unix） | 1（`code()` 为 `None`） | `official CLI terminated by signal N` |
| 本机 Host Runtime 因 Desktop stdin EOF 被关闭 | 0 | `closed the local Host Runtime after Desktop stdin EOF` |
| Shim 自身错误（定位失败、递归、租约冲突等） | 1 | `codexhost shim: <error>`，stdout 为空 |
| `codexhost-node-repl` | 子进程 `code()`，否则 1 | `codexhost tool proxy: <error>` |

转发信号、清理后代、强制终止都会额外在 stderr 打一行说明，但不改变退出码。

## Windows `codexhost-node-repl`

只接受 `NODE_REPL_NODE_PATH` 指向名为 `node.exe` 的文件，执行同目录的 `node_repl.exe`，并注入 `desktop_helper_proxy_environment()`。不搜索 PATH，不经过 shell（测试 `node_repl_proxy_does_not_search_path_for_missing_runtime`）。Launcher 侧由 platform 在 Shim 旁存在该文件时设置 `CODEX_NODE_REPL_PATH`（`docs/platforms/windows/windows-tool-compatibility.md`）。
