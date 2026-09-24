# codexhost-shim（rust）

`codexhost-shim` 是 Launcher 通过 `CODEX_CLI_PATH` 注入给 Codex Desktop 的"官方 Codex CLI 替身"。Desktop 每次调用 CLI 都会先到这里：主 `app-server` 被路由到 codexhost 的 Host Runtime（Node），其余调用（辅助 app-server、`app-server proxy`、`sandbox`、各种子命令）原样转发给官方 CLI。Shim 在两种情况下都做字节透明的 stdio 转发、信号转发和整棵子进程树的清理。它只按命令行形态和进程关系做路由判断，不解析 app-server 报文。

## 依赖与边界

- `Cargo.toml`：库 `codexhost_shim`（`src/lib.rs`）+ 二进制 `codexhost-shim`（`src/main.rs`）、`codexhost-node-repl`（`src/node_repl_main.rs`，只在 Windows 有实现）、`fake-codex-cli`（`tests/fixtures/fake-codex-cli.rs`，`required-features = ["test-utils"]`）。依赖 `codexhost-platform`、`fs2`；Unix 加 `nix`、`signal-hook`。
- 库的公开 API 只有 `run_from_environment`、`run_proxy`、`run_proxy_with_observer`、`ProxyObserver`、`ShimResult`、`app_server_subcommand_index`、`should_start_host_runtime` 和三个环境变量常量。`ProxyObserver` 专供 `tools/gate-a/native` 的 `codexhost-shim-probe` 做采集；生产 Shim 用 `NoopProxyObserver`，并且忽略 Gate 采集环境变量（测试 `production_shim_ignores_gate_capture_environment`）。
- Windows 下两个二进制都在 release 构建中设置 `windows_subsystem = "windows"`，避免弹出控制台窗口；debug 构建保留控制台。
- 上游协议方：Launcher（环境变量）、`packages/host-runtime`（Host Runtime 入口、`remote-host-lifecycle.ts` 调用 `--codexhost-remote-terminate`）、`packages/mapping-store`（遗留 `mapping-store/store.lock`）。

## 模块地图

| 模块 | 职责 |
|---|---|
| `lib.rs` | 路由判断、子命令构造、stdio 泵、信号处理、等待与清理、远程 listener 启动（约 970 行生产代码 + 测试，已超 800 行） |
| `local_runtime_lease.rs` | 本机 Host Runtime 的跨进程单所有者租约（约 920 行） |
| `process_identity.rs` | 按"PID + 启动时间"观察已记录进程，含 Windows 暂时性查询错误重试 |
| `desktop_invocation.rs` | 判断当前调用是否来自 Desktop 的原生工具 helper（Windows/macOS） |
| `remote_lifecycle.rs` | Unix：`--codexhost-remote-terminate` 与远程 listener 复用判断 |
| `node_repl_main.rs` | Windows：Desktop `node_repl` 工具的代理，补齐 helper 丢失的代理环境 |

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [proxy-routing.md](./proxy-routing.md) | 改路由规则、环境变量清理、stdio/信号/退出码、远程 listener、helper 判断时 |
| [local-runtime-lease.md](./local-runtime-lease.md) | 改本机 Host Runtime 单实例、所有者记录格式、交接或遗留迁移逻辑时 |
| [testing.md](./testing.md) | 写或跑 `tests/proxy.rs`、改 `fake-codex-cli` 夹具时 |

## 改动前检查清单

1. 新增路由规则前，先确认它只依赖命令行形态、环境变量或进程关系。需要理解 JSON-RPC 内容的逻辑属于 Host Runtime。
2. 任何转发给官方 CLI 的路径都必须移除 `CODEX_CLI_PATH`、`CODEXHOST_HOST_NODE_PATH`、`CODEXHOST_HOST_RUNTIME_PATH`、`CODEXHOST_REMOTE_SSH_MANAGED`、`CODEXHOST_REMOTE_LISTENER_CHILD`，并且经过 `validate_proxy_target` 防止递归（测试 `preserves_arguments_and_removes_recursive_environment`、`rejects_recursion_without_stdout_output`）。
3. 找不到官方 CLI 时报错，绝不回退到 PATH 搜索（测试 `rejects_missing_official_cli_without_falling_back_to_path`、`browser_helper_fallback_does_not_guess_an_official_cli_from_path`）。
4. stdout 只能承载子进程的原始字节。Shim 自己的诊断全部走 stderr 并以 `codexhost shim:` 开头。
5. 修改所有者记录或锁文件名会影响已发布版本的 Shim（它们可能与新版本同时运行），先读 [local-runtime-lease.md](./local-runtime-lease.md) 的兼容性约束。
6. 定向验证：`cargo test -p codexhost-shim --locked --features codexhost-shim/test-utils`；涉及进程观察时加 `-p codexhost-platform -p codexhost-launcher`。
