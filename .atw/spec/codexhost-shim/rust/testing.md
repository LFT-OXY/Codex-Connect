# 测试

## 结构

- 单元测试：`lib.rs`（参数形态识别、Host 路径选择、刷新节流）、`local_runtime_lease.rs`（记录编解码、变更锁持有时机、v1 迁移）、`process_identity.rs`（Windows 错误码重试，用注入的 `inspect`/`wait` 闭包模拟）、`desktop_invocation.rs`、`remote_lifecycle.rs`。
- 集成测试：`tests/proxy.rs`（约 2800 行），运行真实的 `codexhost-shim` 二进制，并用 `fake-codex-cli` 充当官方 CLI 和 Host Runtime。
- 夹具二进制 `tests/fixtures/fake-codex-cli.rs` 只在 `test-utils` feature 下构建，通过 `env!("CARGO_BIN_EXE_fake-codex-cli")` 引用。所以跑集成测试**必须**带 feature，否则编译失败：

```sh
cargo test -p codexhost-shim --locked --features codexhost-shim/test-utils
cargo test -p codexhost-shim --locked --features codexhost-shim/test-utils --test proxy <test_name>
```

## fake-codex-cli 的约定

- 行为完全由 `FAKE_CODEX_*` 环境变量驱动：`FAKE_CODEX_UNIX_LISTENER_PATH`（扮演远程 listener）、`FAKE_CODEX_SIGNAL_READY`/`FAKE_CODEX_SIGNAL_OBSERVED`/`FAKE_CODEX_IGNORE_SIGNALS`（信号转发）、`FAKE_CODEX_ORPHAN_*`（遗留运行时和孤儿场景）、`FAKE_CODEX_HELPER_*`（嵌套 helper）、`FAKE_CODEX_DETACHED_DESKTOP`（模拟 Desktop 被重挂）等。新增场景时加新的 `FAKE_CODEX_*` 变量，并在派生子进程时 `env_remove` 掉，避免污染下一层。
- 夹具通过"写临时文件再 rename"发布 ready 文件（`write_ready_file`），测试用 `wait_for_file` / `wait_for_child_file_matching` 轮询，而不是 sleep 固定时长。
- 夹具也充当 Host Runtime：`host_runtime_shim` 把 `CODEXHOST_STOCK_CODEX_PATH`、`CODEXHOST_HOST_NODE_PATH`、`CODEXHOST_HOST_RUNTIME_PATH` 都指向 `fake-codex-cli`，并设置 `CODEXHOST_DATA_DIR` 和 `FAKE_CODEX_HOST_RUNTIME_READY`，夹具把收到的环境写进 ready 文件供断言。

## 仅测试可用的钩子

- `lib.rs` 在 `#[cfg(all(target_os = "macos", feature = "test-utils"))]` 下，每完成一次进程树观察就向 `CODEXHOST_TEST_PROCESS_OBSERVATIONS` 指向的文件追加一个 `.`，供测试确认观察确实发生（stderr 泵持有输出锁，不能用 stderr 确认）。生产构建不含这段代码。新增测试钩子必须同样放在 `feature = "test-utils"` 之后。

## 平台覆盖

- 大部分集成测试带 `#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]`；信号转发类（`forwards_external_sigterm_to_the_official_cli_group` 等）只在 macOS；Job 清理（`job_terminates_the_official_cli_tree_when_shim_is_killed`）和 `node_repl` 代理只在 Windows；远程 listener 只在 Unix。
- 测试进程使用唯一临时目录（`temporary_directory` 用静态原子计数器 + PID 命名并 `create_dir` 抢占，有并发唯一性测试 `creates_unique_temporary_directories_concurrently`），结束后自行清理子进程（`force_stop_test_process`）。
- 进程观察相关的改动还应跑 `cargo test --locked -p codexhost-platform -p codexhost-shim -p codexhost-launcher --features codexhost-shim/test-utils`（`docs/platforms/macos/macos-process-observation.md` 指定的组合）。对照快照测试不能替代这些真实生命周期测试。
