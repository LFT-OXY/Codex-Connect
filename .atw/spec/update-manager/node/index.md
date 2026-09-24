# update-manager（Node）

`@codexhost/update-manager` 负责在 Host 进程内完成后台更新的**准备工作**：发现最新 GitHub Release，校验安装布局，下载并校验安装包，写出 Rust Updater 能读取的请求文件和状态文件，然后在需要时拉起 Updater。真正的等待进程退出、安装和重启由 Rust `crates/updater` 完成；macOS 上由 `crates/launcher/src/active_update.rs` 拉起 Updater。更新 RPC 的编排（`codexhost/update/check|start|status`）在 host-runtime 的 `update-coordinator.ts`。

## 上下游

- 依赖：没有任何 Workspace 或第三方依赖（`package.json` 中没有 `dependencies`），只使用 Node 内置模块和全局 `fetch`。不要为了做校验引入 zod，现有的手写解析函数已经够用。
- 下游：只有 `host-runtime` 使用（`update-coordinator.ts`，以及 `run-host-runtime.ts` 引用的 `UPDATE_RUNTIME_ENV`）。
- 与 Rust 的文件契约（改动任何一侧都要同时改另一侧）：

| 文件 | TS 侧 | Rust 侧 | 字段风格 |
|---|---|---|---|
| `update-<version>-<id>/request-v1.json` | `update-manager.ts` 的 `InternalRequest`，以 `wx` 方式写入，权限 0600 | `crates/updater/src/request.rs`（`deny_unknown_fields`，`schema_version == 1`） | snake_case，`installation.kind` 为 kebab-case |
| `update-…/status-v1.json` | `status.ts` 的 `parseUpdateStatus`（严格白名单） | `crates/updater/src/status.rs` 写出 | camelCase，`schemaVersion: 1` |
| `<stateDir>/active-update-v1.lock` | `operation-state.ts` | `crates/launcher/src/active_update.rs`（macOS 上会把 `ownerPid` 转交给 Updater） | `{ ownerPid, statusPath }` |
| `app/codexhost-distribution.json` | `distribution.ts` 的 `parseDistributionMetadata` | `crates/updater/src/install.rs` | camelCase |

状态目录由 `defaultUpdateStateDirectory` 决定：Windows 是 `%LOCALAPPDATA%\codexhost\updates`，macOS 是 `~/Library/Application Support/codexhost/updates`，其他平台是 `~/.codexhost/updates`。它必须与 Launcher 的 `default_descriptor_path()` 所在目录下的 `updates/` 保持一致。

## 核心规则

- **严格解析，拒绝未知字段**：`parseUpdateStatus` 和 `parseDistributionMetadata` 遇到白名单之外的 key 直接报错，版本号必须满足 `SEMVER_PATTERN`。给状态文件新增字段时，要同时修改 TS 白名单、Rust 的 `UpdateStatus`，并考虑是否需要升级 `schemaVersion`。
- **下载安全**：
  - 下载地址只接受不带凭据的 HTTPS（`validateArtifact`），重定向后的最终 URL 会再检查一次；
  - SHA-256 必须是小写十六进制，单个安装包上限 2 GiB；
  - 先下载到 `.<name>.download`，完成后校验大小和 SHA-256，再 rename 到正式文件名；
  - GitHub Release 必须恰好包含一个 `codexhost-<version>-<target>.(dmg|exe)`，且带有 `sha256:` digest，下载 URL 前缀固定为本仓库的 releases/download。
- **Release 发现顺序**：先尝试 `fetchLatestGitHubReleaseWithGitHubCli`（使用 `gh api`，凭据由 gh 和系统钥匙串管理，超时 5s，输出上限 1 MiB）。它返回 `null` 时，再用匿名 HTTP 请求 `fetchLatestGitHubRelease`（`redirect: "error"`）。gh 的 stderr **永远不透传**，因为调试输出里可能含有 token。只有 `ENOENT`/`EACCES`（可执行文件无法启动）时才换下一个候选路径；认证失败或网络失败不会重复请求。显式设置了 `CODEXHOST_GH_COMMAND` 时，不再尝试其他安装位置。
- **错误形态**：本包只抛普通 `Error`，message 是简短英文。写入状态文件时截断到 500 字符（`statusSnapshot`），coordinator 返回给 Desktop 时也截断到 500 字符。不要把完整 stderr 或 URL 查询参数写进 message。
- **状态写入**：`writeStatusSnapshot` 先写到 `.update-status-<id>.tmp` 再 rename。在 Windows 上，`replaceStatusFile` 遇到 `EACCES`/`EBUSY`/`EPERM` 会按 10/30/70/150/300ms 退避重试。下载进度最多每 250ms 写一次，并通过 Promise 链串行写入。
- **操作锁**：`acquireUpdateOperationLock` 以 `wx` 方式创建锁文件，已存在时返回 `null`，调用方随后报告已有更新在进行。`recoverUpdateOperationLock` 只在状态已到终态，或 `ownerPid` 已不存在时删除锁；信息不明确时保留锁（注释："Keep an ambiguous active lock fail-closed"）。解析失败的状态目录不会被自动删除，保留下来用于诊断。
- **平台分工**：
  - `prepareWindowsInstaller` 只能在 win32 上调用，`prepareMacOsDmg` 只能在 darwin 上调用；
  - coordinator 在非 darwin 平台准备完成后调用 `manager.start()`；在 macOS 上只准备，由 Launcher 拉起 Updater（测试 "hands a macOS update to Launcher without starting the Helper"）；
  - `start()` 只接受由同一个 manager 实例准备、且尚未启动的请求。
- **测试注入**：`createBackgroundUpdateManager(dependencies)` 可以注入 `platform`、`randomId`、`download`、`spawnUpdater`、`now`；gh 查询可以注入 `run` 和 `executableCandidates`。新增外部交互时同样通过依赖参数注入，不要 mock 模块。

## 改动前检查清单

1. 修改请求、状态、锁、分发元数据的任何字段之前，先打开上表对应的 Rust 文件，两侧一起修改，并运行 `cargo test -p codexhost-updater --locked`（涉及锁时还要跑 `cargo test -p codexhost-launcher --locked`）。
2. 新增安装方式时，要同时扩展 `BackgroundUpdateInstallation`、`parseUpdateStatus` 的枚举、`InternalRequest.installation`、`resolveInstalledUpdateContext`，以及 Rust 的 `Installation` enum。
3. 所有路径参数都要经过 `requireAbsolutePath` 或 `requireRegularFile`（要求是普通文件且不是符号链接）。不要接受相对路径。
4. 发现、下载、升级都不能静默降级：安装包缺失、digest 缺失或 URL 不符时，`check` 返回 `installationAvailable: false` 并附带 `error`，不能改用其他 asset。
5. 定向验证：`npx vitest run --config tests/vitest.config.js packages/update-manager/test/<file>.test.ts`，与 coordinator 的联动看 `packages/host-runtime/test/update-coordinator.test.ts`。Windows 专属用例使用 `it.skipIf(process.platform !== "win32")`。
