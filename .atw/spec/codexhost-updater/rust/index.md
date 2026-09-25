# codexhost-updater（rust）

`codexhost-updater` 是一次性的后台安装器：读取 TypeScript 侧准备好的更新请求，等待旧 Launcher 退出，安装新版本（npm 全局包、Windows Inno Setup 安装器或 macOS DMG），重新启动 codexhost，并确认新 Launcher 已发布运行时描述符。整个过程通过状态文件汇报进度。下载、校验来源、选择版本都不在这里做。

## 与 TS `packages/update-manager` 的分工

| 步骤 | 负责方 |
|---|---|
| 查询 GitHub Release、选择产物、下载并校验 SHA-256、写 `prepared`/`downloading` 状态 | `update-manager`（`update-manager.ts`、`github-release.ts`、`artifact.ts`） |
| 创建 `updates/active-update-v1.lock`、清理终态目录、恢复死锁 | `update-manager/src/operation-state.ts`，由 `host-runtime/src/update-coordinator.ts` 调用 |
| 把安装目录下的 `libexec/codexhost-updater` 复制到 `updates/update-<version>-<uuid>/`，写 `request-v1.json` | `update-manager#prepareCommon/finalize` |
| 启动 Updater | Windows/Linux：Host Runtime 直接 `spawn(..., {detached: true})`；macOS：由 Launcher 在监督循环里启动，并把锁移交给 Updater 的 PID（见 `codexhost-launcher` spec） |
| 等 Launcher 退出 → 安装 → 重启 → 等新 Launcher 就绪，写 `waiting-for-exit` 及之后的状态 | 本 crate |
| 看到 `waiting-for-exit` 后停止 Desktop 并退出 | Launcher `active_update.rs` |

实际运行的是操作目录里的副本，而不是已安装的 `libexec/codexhost-updater`。代码没有注释说明原因；从流程推断，这样安装器覆盖安装目录时不会碰到正在运行的 Updater 文件。不要改成直接运行安装目录里的 Updater。macOS 上 Launcher 启动前还会校验 helper 位于 `updates/update-*` 目录内且是普通文件。

## 交换协议

命令行：`codexhost-updater apply --request <absolute-json-file>`，其他形式打印 usage 并退出 1。

`request-v1.json`（TS 写，本 crate 读，`UpdateRequest`，**snake_case**，`deny_unknown_fields`）：

```json
{"schema_version":1,"version":"1.2.3","wait_pid":123,"wait_executable":"/abs/codexhost",
 "runtime_descriptor_path":"/abs/desktop-runtime-v1.json","status_path":"/abs/status-v1.json",
 "installation":{"kind":"npm|windows-installer|macos-dmg", ...}}
```

`installation` 按 `kind` 区分（`#[serde(tag = "kind", rename_all = "kebab-case")]`）：`npm` 带 `node_path`、`npm_cli_path`、`npm_launcher_path`；`windows-installer` 带 `installer_path`、`artifact_sha256`、`install_root`；`macos-dmg` 带 `dmg_path`、`artifact_sha256`、`app_path`（必须以 `.app` 结尾）。所有路径必须是绝对路径，文件类路径必须已存在；SHA-256 必须是 64 位小写十六进制；版本号按严格 semver 校验（拒绝 `01.2.3`、`1.2.3-`、路径穿越字符串）。TS 类型在 `update-manager.ts#InternalRequest`，两边字段要同时改。

`status-v1.json`（两边都写，**camelCase**）：`{schemaVersion:1, version, installation, phase, updatedAt(秒), error?}`。TS 还会写 `downloadedBytes`/`totalBytes`，并用 `status.ts#parseUpdateStatus` 拒绝未知字段，所以本 crate 新增字段前必须先放宽 TS 解析。阶段顺序：`prepared` →（`downloading`）→ `waiting-for-exit` → `installing` → `restarting` → `succeeded`，任一步失败写 `failed` 并附错误文本。

运行时描述符：本 crate 用 `RuntimeDescriptorProbe`（`main.rs`）按与 Launcher 相同的规则校验（schema 1、PID/端口非零、32 位小写十六进制 nonce、普通文件、≤ 4 KiB）。新 Launcher 就绪的判定是：描述符里的 `launcher_pid` 不等于旧的 `wait_pid`，且该进程存活（不比对可执行路径，测试 `accepts_a_live_relaunched_launcher_without_executable_path_matching`）。

## 执行流程（`main.rs#apply`）

1. 解析并校验请求，写 `waiting-for-exit`。
2. `wait_for_launcher_exit`：确认 `wait_pid` 仍存在且可执行文件与 `wait_executable` 相同（Windows 忽略大小写和分隔符），然后每 100ms 轮询，最多 180s。PID 已不存在也按失败处理（"Launcher exited before the background Updater started"）。
3. `install`（`install.rs`）：
   - npm：`<node> <npm-cli> install --global --no-audit --no-fund @chinhae/codex-connect@<version>`（包名由 `npm_package_spec` 拼接，有单测）。
   - Windows：先校验安装器 SHA-256，再以 `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-` 运行，最后校验 `<install_root>/app/codexhost-distribution.json` 的 `version` 和 `distribution == "installer"`。
   - macOS：校验 DMG SHA-256 → `hdiutil attach -nobrowse -readonly` → `ditto` 到同目录的 `.codexhost-update-<id>.app` → 校验分发元数据和 `codesign --verify --deep --strict` → 旧 app 改名为 `.codexhost-backup-<id>.app` → 新 app 换入 → 再校验，失败时回滚备份。
4. `relaunch`：npm 用 `node <npm_launcher_path>`，Windows 用 `<install_root>/bin/codexhost-start.exe`，macOS 用 `/usr/bin/open <app_path>`；标准流全部重定向到 null。
5. `wait_for_relaunch`：最多 30s。

## 错误与退出码

- 任何错误：写 `failed` 状态（写失败则忽略），stderr 打印 `codexhost updater: <error>`，`ExitCode::FAILURE`（1）。成功为 0。Updater 由 TS 以 `stdio: "ignore"` 启动，stderr 实际不可见，**状态文件才是唯一可观察的结果**，错误文案要写得能直接展示给用户。
- 平台不匹配的安装类型在请求校验阶段就被拒绝（例如在 macOS 上收到 `windows-installer`），`install.rs` 中对应平台之外的实现也只返回错误。
- 状态写入使用 `create_new` 临时文件 + `sync_all` + `atomic_replace_file`，与 Launcher 描述符写法一致。

## 已知差异与易错点

- 请求是 snake_case，状态和锁文件是 camelCase，这是现状，新增字段按所在文件的既有风格写，不要混用。
- TS 的 `acquireUpdateOperationLock` 最初写入 `statusPath: null`，之后才补上真实路径；Launcher 的 `ActiveUpdateLock` 要求它是路径，在这段时间读取会报 `InvalidData`，只记日志、不影响运行。
- Linux 状态目录不一致（静态比对代码得出，未在 Linux 上实测）：TS `defaultUpdateStateDirectory` 在 Linux 返回 `~/.codexhost/updates`，而 Launcher `active_update.rs#update_state_directory` 取运行时描述符所在目录下的 `updates/`，在 Linux 上是 `$XDG_RUNTIME_DIR/codexhost/updates`（或 `$XDG_STATE_HOME`/`~/.local/state` 下）。Linux 的 npm 更新因此可能无法触发 Launcher 的"为更新退出"，Updater 会在 180s 后因 Launcher 未退出而失败。改动 Linux 更新路径前先确认这一点。
- 除请求校验、版本/哈希格式、就绪判定和分发元数据解析外，安装流程没有自动化测试（依赖系统命令和真实安装）。修改 `install.rs` 时要在对应平台手工验证，并在回报中说明。

## 改动前检查清单

1. 协议字段改动要同时改 `crates/updater/src/request.rs`/`status.rs`、`packages/update-manager/src/update-manager.ts`/`status.ts`，以及 Launcher `active_update.rs` 中的探针结构体。
2. 保持 `deny_unknown_fields`，并保持"写临时文件再原子替换"的写法。
3. 不在本 crate 做网络访问或产物来源判断，它们属于 `update-manager`。
4. 新增安装类型时，先在请求校验阶段按 `cfg!(target_os = ...)` 拒绝不支持的平台。
5. 验证：`cargo test -p codexhost-updater --locked`；协议变化同时跑 `npx vitest run --config tests/vitest.config.js packages/update-manager/test packages/host-runtime/test/update-coordinator.test.ts`（需先 `npm run build:typescript`），以及 `cargo test -p codexhost-launcher --locked`（`active_update.rs` 测试）。
