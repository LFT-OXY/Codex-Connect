# 品牌替换访谈结论（2026-09-25）

上游：`BytePioneer-AI/codex-host`（产品名 codexhost）。本仓库：`LFT-OXY/Codex-Connect`。npm 用户名：`chinhae`。

## 已确认决策

| # | 决策 |
|---|---|
| Q1 | 展示名 `Codex Connect`，slug `codex-connect` |
| Q2 | 长期同步上游 → 改名范围最小化，仅改面向用户与分发层 |
| Q3 | GitHub Releases + npm 双渠道 |
| Q5/Q8 | 保留上游署名：README Acknowledgements 首条 + 关于页一行链接；"新特性"一节不写"Fork 新增"，直接作为产品功能 |
| Q6 | "点个 Star" 保留并指向本仓库；删除 Star History、微信群二维码与 Join the Community、韩文 README（含导航链接） |
| Q7 | 版本沿用上游版本线，本任务不改版本号 |
| Q9/Q17 | 图标源：`/Users/oxy/Downloads/codex-connect-icons/macos-rounded/02-holographic.png`（1024×1024，带透明圆角留边） |
| Q10 | npm：`@chinhae/codex-connect`，平台包 `@chinhae/codex-connect-{darwin-arm64,darwin-x64,win32-x64,win32-arm64,linux-x64,linux-arm64}` |
| Q11 | 替代上游（非并存）：`~/.codexhost`、`CODEXHOST_DATA_DIR`、bundle id `com.codexhost.app`、Windows `AppId`、LaunchAgent `ai.bytepioneer.codexhost.*` 均不变 |
| Q12 | CLI 命令 `codex-connect` / `codex-connect-start`；发布产物 `codex-connect-<ver>-<target>.*`；`Codex Connect.app`、Windows `AppName/AppPublisher=Codex Connect`、`DefaultDirName=Programs\codex-connect` |
| Q13 | 内部代号不变：`@codexhost/*` workspace 包、`codexhost-*` crate、`codexhost/*` 协议方法、`CODEXHOST_*` 环境变量、内部文档与代码注释、`.agents/skills/codexhost-*` |
| Q14 | 术语表已更新（`docs/project/领域术语表.md`）：Codex Connect = 产品名；codexhost = 内部代号 |
| Q16 | README（英文 + zh-CN）在 Interface Preview 之后新增"新特性"一节：① Model 与思考选项拆分为两个独立药丸；② 思考强度滑块胶囊样式、连续拖动与吸附、光泽流动动画。暂无截图 |
| Q18 | 应用内设置品牌图标（`codexhost-app-icon.svg` 的使用处）换成新图标位图内联；`npm start` 检查小尺寸效果，糊则改画简化矢量版 |
| Q19 | 关于页"开源地址"下加"基于开源项目 codex-host 开发"（中英）并链接上游；README Acknowledgements 首条：`Codex Connect is built on [codex-host](https://github.com/BytePioneer-AI/codex-host). Thanks to its authors and contributors.`；保留 Paseo，删除 LINUX DO |
| Q20 | Quick Start 末尾折叠 `<details>`："如果之前装过 codexhost"——`npm rm -g @codexhost/cli` 或删除 `codexhost.app`，会话数据 `~/.codexhost` 自动沿用 |
| Q21 | `release-packages.yml` 仅改产物匹配模式；npm Trusted Publisher 首发配置不在本任务范围 |

## 假设（用户已确认）

- `openspec/`、`docs/archive/` 等历史文档中的上游链接保持原样。
- `*.preview.html` 开发预览页中的上游链接随之更新。
- 面向用户的 CLI 终端提示（Rust launcher 输出等）同样使用 `Codex Connect`。

## 已定位的改动点

- 更新/仓库链接：`packages/update-manager/src/github-release.ts`、`github-cli-release.ts`、`packages/shared-contracts/src/updates.ts`（releaseNotesUrl 校验正则）、`packages/renderer-extension/src/settings/pages.ts`、`connections-page.ts`、`crates/platform/src/desktop_launch.rs:35`、`scripts/release/prepare-npm.mjs`、`prepare-npm-meta.mjs`
- 界面文案：`packages/renderer-extension/src/settings/localization.ts`、`harness-installation-guides.ts`
- 包名与 Star 提示：`scripts/release/prepare-npm.mjs:25-32,292,307-308`
- CLI 与产物名：`scripts/release/prepare-payload.mjs:329,336,419`、`prepare-npm.mjs:376,999`
- 安装包：`scripts/release/macos/package.sh`（Info.plist、iconset、DMG volicon）、`scripts/release/macos/assets.mjs`、`scripts/release/windows/Installer.iss`
- 图标：`crates/launcher/assets/codexhost.png`/`.ico`、`scripts/release/generate-brand-icons.mjs`、`packages/renderer-extension/src/assets/codexhost-app-icon.svg` 及其引用
- CI：`.github/workflows/release-packages.yml`（`codexhost-*` 匹配）
- README：`README.md`、`docs/project/README.zh-CN.md`、删除 `docs/project/README.ko.md`
- 测试：`packages/update-manager/test/`、`packages/shared-contracts/test/updates.test.ts`、`packages/renderer-extension/test/`、`packages/host-runtime/test/`、`tests/release/`
