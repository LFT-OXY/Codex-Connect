# 05 — README 改为 Codex Connect

**What to build:** 访问仓库的人看到的英文与简体中文 README 都以 Codex Connect 为产品，下载、安装、克隆指向本仓库，介绍本版本的新特性，并为从 codexhost 切换过来的用户提供迁移说明；上游专属内容被移除，上游署名保留在致谢中。

**Blocked by:** None — can start immediately（建议在 01、02 之后执行，以核对命令与文件名）
**Status:** ready-for-agent
**Impl:** done

- [x] 标题、简介与正文中的产品名为 Codex Connect；Star 提示保留并指向本仓库
- [x] 下载链接、`git clone` 地址指向 `LFT-OXY/Codex-Connect`；Quick Start 为 `npm install -g @chinhae/codex-connect` 与 `codex-connect`
- [x] Interface Preview 之后新增"新特性"一节，两项：Model 与思考选项拆分为独立药丸；思考强度滑块胶囊样式、连续拖动与吸附、光泽流动动画；不写成 Fork 新增，暂无截图
- [x] Quick Start 末尾有折叠的"如果之前装过 codexhost"说明：卸载 `@codexhost/cli` 或删除 `codexhost.app`，会话数据自动沿用
- [x] macOS 隔离属性命令改为 `xattr -dr com.apple.quarantine "/Applications/Codex Connect.app"`（第 02 票已把 `.app` 改名）；`packages/renderer-extension/src/settings/update-notes.preview.html` 中同一条命令同步修改
- [x] 删除 Star History、微信群二维码与 Join the Community 一节及导航锚点
- [x] 删除韩文 README 及所有指向它的链接
- [x] Acknowledgements 首条为上游署名（英文：`Codex Connect is built on [codex-host](https://github.com/BytePioneer-AI/codex-host). Thanks to its authors and contributors.`，中文对应翻译）；保留 Paseo，删除 LINUX DO
- [x] 英文与简体中文内容同步；所有站内锚点和相对链接有效

**实现备注：**

- 迁移说明额外写了 Windows 一条：安装包按不变的 AppId 原地覆盖，无需卸载。
- `update-notes.preview.html` 中和该命令同一段的示例标题与 "reopen codexhost" 一并改为 Codex Connect，保持示例连贯。
- 删除孤儿图片 `docs/imgs/wechat-qrcode.jpg`，删除 `docs/index.md` 中的韩文 README 入口行。
- 术语表 codexhost 条目补充迁移说明例外，供第 06 票品牌守卫的白名单对齐。
- 简体中文 README 原本比英文少 Kimi Code 徽章与功能矩阵列，这是上游既有差异，本票不补。
