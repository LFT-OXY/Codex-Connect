# 与 TS 侧和系统的交互协议

Launcher 与其他进程之间只通过命令行参数、环境变量、stdout 行和本地 JSON 文件通信。这些都属于跨语言契约，没有共享的类型定义，改动时要同时改两端。

## 命令行（`main.rs#run`）

| 形式 | 行为 |
|---|---|
| 无参数 | `launch(default_launch_options(), false)`，npm/`.app`/Finder 启动都走这里 |
| `--start-menu`（只能单独出现） | Windows `codexhost-start.exe` 传入；启用交互式"Desktop 已在运行"对话框，并隐藏控制台 |
| `--codexhost-resume-appx-thread ...`（`APPX_RESUME_ARGUMENT`） | 仅 Windows，交给 `resume_packaged_application` |
| `inspect [--custom-install <dir>]` | 打印 `key=value` 行（`platform`、`desktop_version`、`install_root`、`desktop_launcher`、`desktop_executable`、`packaged_codex_cli`、`executable_codex_cli`、`desktop_process_ids`，以及各平台的身份字段） |
| `launch [--shim/--node/--host-runtime/--desktop-controller/--renderer/--pi <abs-file>] [--custom-install <abs-dir>]` | 开发/发布时显式覆盖资源路径；未知选项直接报错（测试 `removed_agent_option_is_rejected`） |
| `open-loopback-url`（不接受参数） | 从 stdin 读一行 URL（≤ 4096 字节），只允许无凭据、带非零显式端口的回环地址（IP loopback 或 `localhost`）根路径 `http(s)://<host>:<port>/[?query]`，再调用 `open_external_url` |
| `broker install|status|stop|uninstall [--harness <id>] [--node <abs> --host-runtime <abs>]` | macOS 管理原生 Harness broker LaunchAgent，输出 `state=...` 等 `key=value`；其他平台先解析参数再报"仅 macOS" |
| `harness` / `delegate` / `thread ...` | 用内置 Node 执行 Host Runtime 入口并追加 `--codexhost-delegation-cli`，设置 `CODEXHOST_CLI_PATH=<本 exe>`，子进程退出码原样透传 |

`probe`、`process-stop` 已被移除，`tests/cli.rs` 断言这些命令会失败，且 usage 中不能再出现它们。

## 传给 Desktop 进程树的环境变量（`desktop_environment`）

- 固定注入：`CODEXHOST_HOST_NODE_PATH`、`CODEXHOST_HOST_RUNTIME_PATH`、`CODEXHOST_DEFAULT_AGENT=codex`、`CODEXHOST_LAUNCHER_PID`、`CODEXHOST_LAUNCHER_EXECUTABLE`、`CODEXHOST_RUNTIME_DESCRIPTOR_PATH`、`CODEXHOST_CONTROL_PORT`、`CODEXHOST_CONTROL_NONCE`。platform 层再加上 `CODEX_CLI_PATH=<Shim>` 和 `CODEXHOST_STOCK_CODEX_PATH=<官方 CLI>`。
- 条件注入：`--pi` → `CODEXHOST_PI_COMMAND`；`CODEXHOST_DATA_DIR`（`CODEXHOST_REMOTE_SSH_MANAGED=1` 时不转发，见 `managed_desktop_data_directory`）；`CODEXHOST_STARTUP_TRACE=1`；四个 `CODEXHOST_NPM_*` 路径（只转发绝对路径，因为 AppX/LaunchServices 不继承 Launcher 环境）；`desktop_path_overrides::forwarded` 的目录覆盖。
- macOS 额外追加 `launcher_proxy_environment()`（显式代理变量优先，缺失时用系统静态代理补齐）。
- `CODEX_ELECTRON_USER_DATA_PATH` 同时会被转成 Chromium 参数 `--user-data-dir=`（`desktop_path_overrides::launch_arguments`），因为 Electron 的 userData 覆盖管不到早期 session 存储。

## Desktop Controller（`packages/desktop-control`）

- 命令：`<node> <desktop-controller> --renderer-cdp-endpoint http://127.0.0.1:<port> --renderer <file> --default-agent codex --attachment-port <port> --attachment-nonce <nonce>`；stdin 为 null，stdout 管道，stderr 继承。
- 只转发 `CODEXHOST_STARTUP_TRACE` 和代理相关变量（`HTTP(S)_PROXY`、`ALL_PROXY`、`NO_PROXY` 大小写两种和 `NODE_USE_ENV_PROXY`），测试 `controller_receives_only_the_managed_network_environment` 覆盖。
- Readiness：stdout 第一行必须恰好是 `{"schemaVersion":2,"state":"compatible","issues":[]}\n`，最长 513 字节（TS 侧上限 512 字节 + 换行）。`compatibility.rs` 用 `deny_unknown_fields` 严格解析，任何降级状态或非空 `issues` 都视为失败。
- 附加握手：`ATTACH <nonce>\n` → `ready` / `busy` / `rejected` / `failed`（TS 侧 `controller-attachment-server.ts`）。

## stdout 行协议

- `ready\n`：启动成功的唯一信号，由 npm wrapper 和 `tools/dev-desktop/run.mjs` 消费，测试 `ready_line_is_the_exact_wrapper_protocol` 固定其字节。打印之后才调用 `detach_from_terminal`。
- 除 `inspect`、`broker` 的 `key=value` 输出外，Launcher 不应向 stdout 写其他内容；诊断走 stderr。

## 持久化文件

| 文件 | 格式 | 写入方 / 读取方 |
|---|---|---|
| `desktop-runtime-v1.json` | `{"schema_version":1,"launcher_pid","control_port","nonce"}`，snake_case，`deny_unknown_fields` | Launcher 写；Launcher、Updater（`RuntimeDescriptorProbe`）、Host Runtime（经 `CODEXHOST_RUNTIME_DESCRIPTOR_PATH`）读 |
| `launcher-v1.lock` | 空文件，仅用作 `fs2` 排他锁 | Launcher |
| `updates/active-update-v1.lock` | `{"ownerPid","statusPath"}`，camelCase | TS `update-manager` 创建；macOS Launcher 移交给 Updater |
| `updates/update-*/status-v1.json`、`request-v1.json` | 见 `codexhost-updater` spec | TS 与 Updater |

## 错误与退出码

- `main` 把 `run` 的任意错误统一打印为 `codexhost launcher: <error>` 并返回 `ExitCode::FAILURE`（1）；从开始菜单启动时还会弹 `show_error_dialog`。
- 唯一的例外是委托 CLI：子进程失败时直接 `std::process::exit(status.code().unwrap_or(1))`，保留 Host Runtime 的退出码。
- 被附加（`LauncherOwnership::Attached`）、Windows 对话框选"取消"都属于成功退出（0）。
- 启动耗时埋点只在 `CODEXHOST_STARTUP_TRACE=1` 时输出到 stderr。
