# 03 — 应用内更新与反馈指向本仓库

**What to build:** 用户在任意平台"检查更新"时查询的是 `LFT-OXY/Codex-Connect` 的最新 Release；点击发布说明打开本仓库的 Release 页；Windows 手动下载拿到本仓库的 `codex-connect-*.exe`；设置页的"反馈问题"打开本仓库的 Issue 页；原生启动器引导用户下载时也指向本仓库。上游仓库的发布 URL 被视为非法。

**Blocked by:** 02 — 安装包命名与新图标（Windows 手动下载链接依赖新的产物文件名）
**Status:** ready-for-agent
**Impl:** done

- [x] GitHub API 与 GitHub CLI 两条更新发现路径都查询 `LFT-OXY/Codex-Connect` 的 latest release
- [x] 发布说明 URL 与下载 URL 的校验只接受本仓库，上游仓库 URL 被拒绝（契约 schema 与 update-manager 两处一致）
- [x] 设置页的仓库地址、Issue 入口、发布说明链接、Windows 手动下载链接指向本仓库，下载文件名为 `codex-connect-<版本>-windows-<架构>.exe`
- [x] Rust 启动器的 latest release 回退地址指向本仓库
- [x] host-runtime、renderer 客户端、settings 测试中的 fixture URL 与断言同步更新
- [x] 开发预览页中的上游链接同步更新
- [x] 现行规格 `openspec/specs/github-release-background-update/spec.md` 中的更新端点同步为本仓库（`openspec/changes/archive` 历史不改）；产物文件名 `codex-connect-*` 与 update-manager 的 `expectedInstallerAssetName` 已随第 02 票改名完成
- [x] update-manager、shared-contracts、renderer settings、host-runtime 受影响测试通过；Rust 回退地址若已有测试覆盖则同步更新
