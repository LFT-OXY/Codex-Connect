# codexhost-launcher（rust）

`codexhost-launcher` 产出用户直接运行的 `codexhost` 可执行文件：定位安装资源、发现官方 Codex Desktop、以受管方式启动 Desktop（把 Shim 注入为 `CODEX_CLI_PATH`）、拉起 Desktop Controller、监督整棵进程树直到退出，并在 macOS 上把后台更新交给 Updater。它不解析 Host 协议，也不做 Harness 判断；`harness` / `delegate` / `thread` 子命令只是原样转发给 Host Runtime 的 Node 入口。

## 依赖与边界

- `Cargo.toml`：两个二进制 `codexhost`（`src/main.rs`）和 `codexhost-start`（`src/start_menu.rs`，仅 Windows 有实现，其他平台是空 `main`）。依赖 `codexhost-platform`、`fs2`（Launcher 单实例锁）、`getrandom`（nonce）、`serde`/`serde_json`；Linux 额外依赖 `nix`、`rustix`（`secure_storage.rs`）。
- `build.rs` 只在 Windows 目标下用 `winresource` 嵌入 `assets/codexhost.ico` 和 `windows.manifest`；改图标流程见 `assets/README.md`，不要手工替换 ICO。
- 下游消费者（改输出格式前必须同步）：
  - `tools/dev-desktop/run.mjs`、`scripts/release/prepare-npm.mjs` 依赖 stdout 上的 `ready` 行。
  - `tools/gate-a/run.mjs#parseInspection` 解析 `codexhost inspect` 的 `key=value` 行。
  - `packages/host-runtime/src/launcher-url-opener.ts` 调用 `open-loopback-url`。
  - `packages/desktop-control`（Controller readiness、`ATTACH <nonce>` 握手）、`packages/update-manager`（运行时描述符和更新状态文件）。
- 所有平台相关的进程/安装能力都来自 `codexhost_platform`；本 crate 只做编排。

## 模块地图

| 模块 | 职责 |
|---|---|
| `main.rs` | CLI 分发、启动编排、三平台 `launch` / `supervise_desktop`、Desktop 环境变量构造（约 1250 行生产代码 + 630 行测试，已超 800 行阈值） |
| `runtime_instance.rs` | 三态启动分类 `classify_startup`、运行时描述符 `desktop-runtime-v1.json`、单实例锁 `launcher-v1.lock` |
| `desktop_attachment.rs` | 端口/nonce 分配、Launcher 所有权获取与退避重试、`ATTACH` 握手、Host chain 等待、Windows 陈旧 Launcher 清理 |
| `compatibility.rs` | Desktop Controller readiness 行的严格解析 |
| `installation_layout.rs` | 从可执行文件位置推导 Shim/Node/Host Runtime/Controller/Renderer 路径（发布布局、`.app` 布局、源码 `target/{debug,release}` 布局） |
| `active_update.rs` | 读取 `updates/active-update-v1.lock`，判断是否要为更新退出；macOS 下负责拉起 Updater 并移交锁 |
| `desktop_path_overrides.rs` | 只转发 `HOME`/`USERPROFILE`/`ZDOTDIR`/`CODEX_HOME`/`CODEX_ELECTRON_USER_DATA_PATH` 这几个绝对路径覆盖 |
| `native_harness_broker.rs` | `codexhost broker install|status|stop|uninstall` 参数解析与 macOS 执行 |
| `secure_storage.rs` | 仅 Linux：`O_NOFOLLOW` + `0700`/`0600` 的私有运行目录与文件操作 |
| `system_proxy_environment.rs` | 仅 macOS：包一层 `codexhost_platform::proxy_environment()` |

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [process-lifecycle.md](./process-lifecycle.md) | 改启动顺序、单实例/附加逻辑、监督循环、为更新退出、各平台 `launch` 分支时 |
| [interfaces.md](./interfaces.md) | 改 CLI 子命令、传给 Desktop/Controller 的环境变量或参数、ready/inspect 输出、描述符或更新文件格式、退出码时 |
| [testing.md](./testing.md) | 写或跑测试、需要验证平台分支时 |

## 已知技术债（照实记录，不要扩散）

- `main.rs` 同时承载 CLI、三份 `launch`/`supervise_desktop` 实现和大量测试。新增能力请放进独立模块（参照 `desktop_attachment.rs`、`active_update.rs` 的拆分方式），不要继续往 `main.rs` 堆。
- `launch` 有两份：`#[cfg(not(target_os = "linux"))]`（macOS + Windows 共用循环）和 `#[cfg(target_os = "linux")]`（单次判定）。改启动规则时两份都要看。
- Linux/Windows 在本 crate 里自定义了 `UnmanagedDesktopConflict`，文案与 `PlatformError::UnmanagedDesktopConflict` 完全相同；Windows 的重试分支同时用 `downcast_ref` 和 `error.to_string() == UNMANAGED_DESKTOP_MESSAGE` 识别它，改文案会让重试失效。
- `CODEXHOST_HOST_NODE_PATH`、`CODEXHOST_HOST_RUNTIME_PATH` 等环境变量名在 `main.rs`、`installation_layout.rs`、`crates/shim/src/lib.rs` 各自声明了字符串常量，并未共享（platform 只导出 `CODEX_CLI_PATH_ENV`、`STOCK_CODEX_PATH_ENV` 等少数几个）。改名时要几处一起改。

## 用户可见文字与诊断输出

产品名规则见 `docs/project/领域术语表.md`：面向用户的文字写 `Codex Connect`，诊断输出保留内部代号 `codexhost`。

| 输出 | 位置 | 写法 |
|---|---|---|
| 未托管 Desktop 冲突 | `main.rs#UNMANAGED_DESKTOP_MESSAGE`、`codexhost-platform` 的 `PlatformError::UnmanagedDesktopConflict` | `Codex Desktop is already running outside Codex Connect; completely quit it before starting Codex Connect`，两处逐字相同（Windows 重试分支用 `to_string()` 比较） |
| usage | `main.rs#usage`、`native_harness_broker.rs` | 命令名写 `codex-connect`，即 npm 暴露的命令；npm 入口把用户参数原样转发给原生二进制 `bin/codexhost` |
| Windows 错误弹窗 | `main.rs`（`--start-menu` 启动失败）、`start_menu.rs` | `Codex Connect could not start: {error}`；弹窗标题由 `codexhost-platform/windows_ui.rs` 统一为 `Codex Connect` |
| stderr 诊断 | `main.rs` 顶层错误、`[codexhost startup …]` trace | 保留 `codexhost launcher:` 前缀 |
| 错误正文 | 例如 `did not start the codexhost Host chain`、`codexhost control endpoint …` | 描述内部组件的诊断文字，保留 `codexhost` |

- 品牌守卫：`tools/brand-guard.test.mjs` 扫描本 crate 与 `codexhost-platform` 的非测试字符串字面量。上表"stderr 诊断"与"错误正文"两行对应白名单中按文件限定的规则。新增的诊断文字如果被误报，就在守卫里补短语或前缀并写明理由，不要改成产品名。
- 验证：`tests/cli.rs` 断言 usage 含 `codex-connect inspect` / `codex-connect launch`，并断言源码中存在冲突文案；`codexhost-platform` 的 Linux 测试 `cleanup_failure_does_not_hide_an_unmanaged_desktop_conflict` 匹配 `outside Codex Connect`。
- 错误示例：`show_error_dialog(&format!("codexhost launcher: {error}"))` 会把诊断前缀显示在弹窗里。正确写法：stderr 用 `eprintln!("codexhost launcher: {error}")`，弹窗用 `show_error_dialog(&format!("Codex Connect could not start: {error}"))`。

## 改动前检查清单

1. 先确认改动属于"原生启动/进程编排"。要读 Thread、Harness 或 app-server 报文的逻辑应放到 TypeScript 包。
2. 改 stdout 输出（`ready`、`inspect`、`broker` 的 `key=value`）前，先 grep 上面列出的下游消费者并同步修改。
3. 改启动流程时保持 `tests/cli.rs` 中源码断言成立：`StartupState::{RecoverStale,CleanLaunch,Attach}`、`acquire_launcher_ownership`、"completely quit it before starting Codex Connect" 必须仍在 `main.rs`，且不能出现 `attach_unmanaged_desktop`。
4. 新增传给 Desktop 的环境变量时，确认 macOS LaunchServices（`open --env`）和 Windows AppX 激活都能传递；只转发绝对路径，不转发认证材料（见 `desktop_path_overrides.rs` 注释）。
5. 新增的平台分支必须让三平台都能编译；本地只能跑宿主平台，其余平台依赖 CI 四平台矩阵（`docs/operations/repository-maintenance.md`）。
6. 改运行时描述符或更新状态文件的字段时，同时改 `crates/updater/src/main.rs#RuntimeDescriptorProbe` 和 `packages/update-manager`，并保持 `deny_unknown_fields`。
7. 定向验证：`cargo test -p codexhost-launcher --locked`；涉及进程监督时加跑 `cargo test --locked -p codexhost-platform -p codexhost-shim -p codexhost-launcher --features codexhost-shim/test-utils`。
