# 02 — 安装包命名与新图标

**What to build:** 用户从 Releases 下载 `codex-connect-<版本>-<平台>.dmg/exe`；macOS 上安装得到带新图标的 `Codex Connect.app`，DMG 卷图标也是新图标；Windows 安装向导、开始菜单、"应用和功能"中显示 Codex Connect 和新图标，新安装默认进入 `Programs\codex-connect`，已装 codexhost 的机器原地覆盖升级。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 发布产物文件名前缀为 `codex-connect-`（dmg、exe 及 payload 产物）
- [x] 发布工作流中安装包的匹配模式与上传文件列表同步更新
- [x] macOS：`.app` 名称、`CFBundleName`、`CFBundleDisplayName` 为 Codex Connect；`CFBundleIdentifier` 仍为 `com.codexhost.app`
- [x] Windows：`AppName`、`AppPublisher` 为 Codex Connect；`DefaultDirName` 为 `Programs\codex-connect`；`AppId` GUID 不变
- [x] 启动器品牌 PNG 替换为 `/Users/oxy/Downloads/codex-connect-icons/macos-rounded/02-holographic.png`，多尺寸 `.ico` 用现有脚本重新生成；macOS `.icns` 与 DMG 卷图标由其生成
- [x] 品牌图标来源的资源说明文档已更新
- [x] LaunchAgent 标签与数据目录不变
- [x] packagers、payload、dmg-assets 等受影响的 release 测试已更新并通过
