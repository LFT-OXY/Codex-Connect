# 测试

## 布局

- 单元测试在各模块的 `#[cfg(test)] mod tests`。`main.rs` 的测试覆盖参数解析、Controller 命令和环境构造、ready 行、readiness 读取上限、附加握手；`runtime_instance.rs` 覆盖三态分类、描述符严格解析、锁唯一性和 Linux 私有文件规则；`active_update.rs` 覆盖锁/状态/请求的归属校验和 Updater 就绪握手。
- `tests/cli.rs` 是集成测试，通过 `env!("CARGO_BIN_EXE_codexhost")` 运行真实二进制，主要做两类断言：
  - 读取 `src/main.rs` 源码做字符串断言，锁定三态启动流程（`production_launcher_uses_the_three_state_running_desktop_flow`）。重命名这些符号会让测试失败，这是有意为之。
  - 把二进制复制到临时的 `bin/` 或 `codexhost.app/Contents/MacOS/` 下运行，断言它按发布布局去找 `libexec/codexhost-shim`，报错里带 "bundled Shim"。
- 很多测试用 `#[cfg(target_os = "...")]` 限定平台，例如 `linux_runtime_*`、Windows 的 verbatim 路径归一化测试，只在对应平台编译和运行。

## 常用手法

- 附加握手用真实的 `TcpListener::bind(("127.0.0.1", 0))` 起一个假 Controller，回写 `busy` 或延迟关闭，验证 Launcher 把它当成暂时不可用（`desktop_attachment.rs` 测试）。
- 需要真实子进程时用系统 shell 充当 Controller 夹具（macOS `/bin/bash -c "trap '' TERM; ..."`，Windows `cmd.exe /c ping ...`），经 `spawn_supervised` 包装后验证 `stop_desktop_controller` 的优雅终止和强制终止（`force_stops_a_controller_that_ignores_graceful_termination`、`intentional_controller_termination_accepts_the_job_exit_status`）。
- 文件系统测试使用 `std::env::temp_dir()` 加 PID 和纳秒时间戳组成唯一目录，测试结束自行删除；不要写入真实的 `~/Library/Application Support/codexhost` 或 `%LOCALAPPDATA%`。

## 验证命令

```sh
cargo test -p codexhost-launcher --locked
# 涉及进程监督、描述符或更新交接时，连同 platform 和 shim 一起跑
cargo test --locked -p codexhost-platform -p codexhost-shim -p codexhost-launcher --features codexhost-shim/test-utils
```

`npm start` 会先停止正在运行的 Codex Desktop 再启动（`tools/dev-desktop/run.mjs`），只在确实需要端到端启动时使用，不作为常规验证。未在其他平台执行的 cfg 分支要在回报中说明依赖 CI。
