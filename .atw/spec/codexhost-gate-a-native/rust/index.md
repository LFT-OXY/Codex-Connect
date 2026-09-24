# codexhost-gate-a-native（rust）

`tools/gate-a/native` 是 Gate A（"官方 Desktop 能以受管方式启动，并通过 `CODEX_CLI_PATH` 调用 Shim"）的原生探针，不属于产品。它提供两个只在 `gate-tools` feature 下构建的二进制：

- `codexhost-probe`：发现官方 Desktop，确认没有正在运行的实例，用 `codexhost-platform` 以受管方式启动 Desktop（Shim 路径由 `--shim` 指定），等待 Shim 写出采集文件，然后按参数退出、关闭 Desktop 或继续监督。
- `codexhost-shim-probe`：直接调用 `codexhost_shim::run_proxy_with_observer`，传入 `ProbeCapture` 作为 `ProxyObserver`，在代理前后各写一条 JSON 采集记录。它复用生产 Shim 的代理核心，不另写一份实现。

## 依赖与构建

- `Cargo.toml`：`codexhost-platform`、`codexhost-shim` 都是 optional，只由 `gate-tools` feature 引入；`default = []`。不带 feature 时库里只有空壳（`lib.rs` 的内容全部 `#[cfg(feature = "gate-tools")]`），`tests/capture.rs` 也用 `#![cfg(feature = "gate-tools")]` 整体屏蔽。
- 它在 workspace `members` 里但不在 `default-members` 里，`npm run build:rust` 不会构建它；`npm run test:rust` / `check:rust` 通过 `--features codexhost-gate-a-native/gate-tools` 把它纳入测试和 clippy。
- 没有 `serde` 依赖：采集记录用 `format!` 手写 JSON，字符串统一经过 `capture.rs#json_string` 转义（测试 `escapes_json_control_characters`）。新增字段也要走 `json_string`，不要直接拼接未转义的值。

## 与 `tools/gate-a/run.mjs` 的协议

- `run.mjs` 先检查 `target/debug/codexhost` 和 `codexhost-shim` 已构建，再执行 `cargo build --locked --package codexhost-gate-a-native --features gate-tools`，并用 `target/debug/codexhost inspect` 的 `key=value` 输出获取安装信息（`parseInspection` 要求 `platform`、`desktop_version`、`install_root`、`desktop_launcher`、`desktop_executable`、`packaged_codex_cli`、`executable_codex_cli`、`desktop_process_ids`）。
- 探针命令行：`codexhost-probe --shim <abs> [--launch-mode launch-services|direct-executable] [--output <dir>] [--wait-seconds N] [--exit-after-capture | --shutdown-after-capture]`。macOS 必须显式给 `--launch-mode`；Linux 只允许 `direct-executable`；两种 capture 处置互斥。
- 探针通过环境变量把采集上下文传给 Desktop，再由 Desktop 传给 Shim：`CODEXHOST_PROBE_OUTPUT`（输出目录）、`CODEXHOST_DESKTOP_VERSION`、`CODEXHOST_INSTALL_ROOT`、`CODEXHOST_LAUNCH_MODE`。其中 `CODEXHOST_INSTALL_ROOT` 与 platform 的 `CUSTOM_INSTALL_ROOT_ENV` 是同一个变量名。
- 探针 stdout 输出 `capture=<file>`、`desktop_version=...`（Unix 还有 `desktop_process_id=...`）；失败时 stderr 输出 `codexhost Gate Probe: <error>` 加 usage，退出码 1。
- 采集文件：每条记录先写 `<ms>-<pid>-<kind>.tmp` 再 rename 成 `.json`；探针的 `capture_files` 只认 `.json`，`run.mjs` 比较探针运行前后 `raw/` 目录的文件集合，要求新增恰好一条 invocation 和一条 exit，且属于同一个 Shim 进程。记录字段为 **snake_case**（`schema_version: 1`、`record_type: invocation|exit`、`process_id`、`args`、`stock_codex_path`、`environment_presence` 等；Unix 额外有 `architecture`、`process_group_id`、`launch_mode`、`exit_signal`），`tools/gate-a/capture.mjs` 负责解析、去除绝对路径并转成 camelCase，然后用 `contracts.mjs` 的 zod schema（`PROBE_SCHEMA_VERSION = 1`）校验。改字段时三处（`capture.rs`、`capture.mjs`、`contracts.mjs`）要同时改。
- `environment_presence` 只记录变量**是否存在**，不记录值；不要把环境变量值或凭据写进采集记录。

## 边界与易错点

- Gate A 专用的平台开关在 platform 里，不在这里：Windows 的 `CODEXHOST_PROBE_PACKAGE_NAME` 等六个 `CODEXHOST_PROBE_*` 覆盖必须全部提供或全部缺省（`installation.rs#probe_package_details`）。
- 生产 Shim 必须忽略采集变量（`crates/shim/tests/proxy.rs#production_shim_ignores_gate_capture_environment`）。采集逻辑只能放在本 crate 的 `ProxyObserver` 实现里，不要把采集代码加进 `codexhost-shim`。
- 生产 Launcher 拒绝 `probe` 子命令（`crates/launcher/tests/cli.rs#production_launcher_rejects_the_gate_probe_command`）。探针能力只能留在这个 crate。
- 探针在 Desktop 已运行时直接失败（"close it normally before starting an isolated probe"），不会终止用户的 Desktop。

## 改动前检查清单

1. 修改 `codexhost_shim` 或 `codexhost_platform` 的公开 API 后，带 feature 编译本 crate：`cargo build --locked -p codexhost-gate-a-native --features gate-tools`。
2. 改采集记录格式时同步 `capture.mjs`、`contracts.mjs`，并更新 `tests/fixtures/gate-a/<platform>/` 下受影响的夹具。
3. 验证：`cargo test --locked -p codexhost-gate-a-native --features gate-tools`（含 `tests/capture.rs`，它用 `/usr/bin/true` 或 `cmd /C exit 0` 作为无害的"官方 CLI"运行 `codexhost-shim-probe`）；JS 侧 `npx vitest run --config tests/vitest.config.js tools/gate-a`。
4. 真实 Gate 运行（`npm run gate:a:*`）会启动官方 Desktop，需要先完全退出正在运行的 Desktop，只在明确需要时执行。
