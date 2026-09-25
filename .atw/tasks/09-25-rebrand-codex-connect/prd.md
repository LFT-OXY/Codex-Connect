# 品牌替换为 Codex Connect

**Status:** ready-for-agent

## Problem Statement

本项目 Fork 自上游开源项目 codex-host（产品名 codexhost），并已做二次开发，准备以 `LFT-OXY/Codex-Connect` 开源发布，供他人安装使用。但用户目前看到的一切仍然是上游品牌：界面、安装包、CLI 命令、图标都叫 codexhost；应用内的检查更新、发布说明、问题反馈、"开源地址"都指向上游仓库；npm 安装命令是上游占有的 `@codexhost/cli`；README 里是上游的下载地址、Star 提示、Star History、微信群和致谢。

结果是：用户装了这个版本，却会从上游拉取更新（直接被上游版本覆盖、丢掉本版本的改动），问题会报到上游，而维护者自己无法通过 npm 发布，也无法让用户辨认出这是一个独立产品。

## Solution

把**面向用户的品牌与分发层**全部换成 Codex Connect，把**内部代号与机器标识**保持为 codexhost：

- 用户在界面、安装包、CLI 命令、npm 提示、README 中看到的产品名都是 `Codex Connect`（slug `codex-connect`），图标是新的全息双括号图标。
- 应用内检查更新、发布说明、手动下载、问题反馈、开源地址全部指向 `LFT-OXY/Codex-Connect`。
- 通过 `npm install -g @chinhae/codex-connect` 安装，执行 `codex-connect` 启动。
- Codex Connect 被定位为 codexhost 的**替代版本**：沿用相同的数据目录与机器标识，从上游切换过来的用户会话、账号配置自动沿用；两者不并存。
- 内部代码标识符、协议命名空间、环境变量、内部文档保持 `codexhost`，使长期合并上游时冲突面最小。
- 对上游的署名保留在 README 致谢和"关于"页面，但产品本身以独立项目的面貌呈现。

## User Stories

1. 作为新用户，我想在 README 顶部看到 `Codex Connect` 这个产品名，以便知道自己正在了解的是哪个项目。
2. 作为新用户，我想从 README 的下载链接跳到 `LFT-OXY/Codex-Connect` 的 Releases，以便下载到这个版本而不是上游版本。
3. 作为新用户，我想用 `npm install -g @chinhae/codex-connect` 安装，以便通过 npm 获取这个版本。
4. 作为新用户，我想用 `codex-connect` 命令启动，以便命令名与产品名一致、容易记住。
5. 作为 npm 安装用户，我想在安装完成后看到指向 `LFT-OXY/Codex-Connect` 的 Star 提示，以便支持这个项目。
6. 作为 macOS 用户，我想从 Releases 下载 `codex-connect-<版本>-macos-<架构>.dmg`，以便从文件名就能认出产品。
7. 作为 macOS 用户，我想在"应用程序"、Dock、启动台里看到名为 `Codex Connect` 的应用和新图标，以便与其他应用区分。
8. 作为 macOS 用户，我想让新图标呈现为标准的圆角方形，以便在 Dock 里与系统其他图标风格一致。
9. 作为 macOS 用户，我想打开 DMG 时卷图标也是新图标，以便安装过程中的品牌一致。
10. 作为 Windows 用户，我想下载 `codex-connect-<版本>-windows-<架构>.exe`，以便从文件名就能认出产品。
11. 作为 Windows 用户，我想安装向导、开始菜单、"应用和功能"里显示 `Codex Connect` 和新图标，以便识别已安装的软件。
12. 作为 Windows 新用户，我想默认安装到 `Programs\codex-connect`，以便安装目录与产品名一致。
13. 作为 Windows 上已安装 codexhost 的用户，我想安装 Codex Connect 时原地覆盖升级，以便不会在系统里留下两个互相冲突的安装。
14. 作为 Linux 用户，我想通过 npm 安装后同样使用 `codex-connect` 命令，以便三个平台的使用方式一致。
15. 作为任何平台的用户，我想让应用内"检查更新"去 `LFT-OXY/Codex-Connect` 的最新 Release 查询，以便收到的是这个版本的更新，而不是被上游版本覆盖。
16. 作为收到更新提示的用户，我想点"发布说明"打开 `LFT-OXY/Codex-Connect` 的 Release 页面，以便看到本版本的更新内容。
17. 作为自动更新失败的用户，我想看到的手动更新命令是 `npm install -g @chinhae/codex-connect`，以便自行完成更新。
18. 作为 Windows 用户，我想手动下载链接指向 `LFT-OXY/Codex-Connect` 的 `codex-connect-*.exe`，以便下载到正确的安装包。
19. 作为遇到问题的用户，我想从设置页的"反馈问题"入口打开 `LFT-OXY/Codex-Connect` 的 Issue 页面，以便把问题报给真正的维护者。
20. 作为用户，我想在设置页头部和标题栏设置按钮上看到新图标，以便界面内的品牌与安装包一致。
21. 作为用户，我想让设置页里所有提到产品名的文案（中文和英文）都显示 `Codex Connect`，以便界面措辞一致。
22. 作为用户，我想让 Harness 安装引导里的说明（例如"修改安装路径后需重启 …"）使用 `Codex Connect`，以便知道要重启的是哪个程序。
23. 作为用户，我想在"关于"页面看到 Codex Connect 的简介和开源地址 `LFT-OXY/Codex-Connect`，以便找到源代码。
24. 作为用户，我想在"关于"页面看到一行"基于开源项目 codex-host 开发"并可以跳转上游，以便了解项目来源。
25. 作为从命令行启动的用户，我想让启动器在终端输出的提示使用 `Codex Connect`，以便终端与界面措辞一致。
26. 作为之前装过 codexhost 的用户，我想在 README 的 Quick Start 里找到一段折叠的迁移说明，以便知道要卸载 `@codexhost/cli` 或删除 `codexhost.app`。
27. 作为从 codexhost 切换过来的用户，我想让会话映射、账号配置等数据继续可用，以便切换不丢失历史。
28. 作为从 codexhost 切换过来的 macOS 用户，我想让已注册的原生 Harness Broker 后台服务继续工作，以便不需要重新配置。
29. 作为 README 读者，我想在 Interface Preview 之后看到"新特性"一节，介绍 Model 与思考选项拆分为两个独立药丸，以便了解这个版本的新能力。
30. 作为 README 读者，我想在"新特性"里看到思考强度滑块改为胶囊样式、支持连续拖动与吸附、并带光泽流动动画，以便了解交互上的改进。
31. 作为中文 README 读者，我想让简体中文 README 与英文 README 内容同步，以便获得同样完整的信息。
32. 作为 README 读者，我不想再看到韩文版入口、Star History 图、微信群二维码和 Join the Community 一节，以便 README 只包含这个项目实际维护的内容。
33. 作为 README 读者，我想在 Acknowledgements 首条看到对 codex-host 的署名与感谢，以便了解项目基础并尊重原作者。
34. 作为 README 读者，我想让 Acknowledgements 保留 Paseo，但不再包含上游社区（LINUX DO）的致谢，以便致谢内容与本项目实际相符。
35. 作为想参与开发的人，我想让 README 的 `git clone` 地址指向 `LFT-OXY/Codex-Connect`，以便克隆到正确的仓库。
36. 作为 npm 包的浏览者，我想让 npm 包页面上的仓库、Issue 和主页链接都指向 `LFT-OXY/Codex-Connect`，以便从 npm 找到源码与问题反馈入口。
37. 作为维护者，我想让发布流水线产出并上传 `codex-connect-*` 命名的安装包和 npm 包，以便发布无需手动改名。
38. 作为维护者，我想让发布流水线继续使用 OIDC 可信发布，以便不需要在仓库里保存 npm 令牌。
39. 作为维护者，我想让内部包名、crate 名、协议方法、环境变量和内部文档保持 `codexhost`，以便合并上游时冲突最少。
40. 作为维护者，我想让术语表明确区分产品名 Codex Connect 与内部代号 codexhost，以便今后写代码和文档时不混用。
41. 作为维护者，我想在合并上游之后，能通过测试发现重新混入的上游仓库链接或用户可见的旧产品名，以便品牌不会悄悄回退。
42. 作为维护者，我想让版本号继续沿用当前版本线，以便应用内更新比较逻辑不需要变化。
43. 作为维护者，我想让历史设计文档和已归档的变更记录保留原来的上游链接，以便它们仍然准确记录当时的事实。

## Implementation Decisions

**命名规则**

- 产品名 `Codex Connect`：所有面向用户的文本，包括界面文案（中英文）、安装包显示名与发布者、`.app` 名称、CLI 终端提示、npm 安装后提示、README。
- slug `codex-connect`：npm 暴露的 CLI 命令 `codex-connect`（`bin/codex-connect.js`）、发布产物文件名前缀、Windows 默认安装目录、npm 包名后缀。
- Rust 原生层中直接呈现给用户的文字（错误弹窗、启动失败报错）使用 Codex Connect；stderr 诊断日志前缀（如 `codexhost launcher:`、`codexhost shim:`）视为内部诊断输出，保留 codexhost。
- 内部代号 `codexhost`：代码标识符、`@codexhost/*` workspace 包、`codexhost-*` crate 与内部二进制（更新器、Shim，以及原生启动器 `bin/codexhost`、Windows 开始菜单入口 `codexhost-start.exe`；实现期间决定，因为这些二进制不在用户 PATH 中，改名会牵动 Launcher、Updater、安装器和开发工具）、`codexhost/*` 协议方法、`CODEXHOST_*` 环境变量、CSS 类名与 DOM id、内部文档与代码注释、`.agents/skills/codexhost-*`。
- 以上规则已写入术语表：Codex Connect = 产品名；codexhost = 内部代号，面向用户的文本中避免使用；驼峰 `CodexHost` 列为 Avoid。

**分发身份**

- 仓库身份：`LFT-OXY/Codex-Connect`，替换所有运行时与分发元数据里的上游仓库地址。涉及：
  - 更新发现（GitHub API 与 GitHub CLI 两条路径的 latest release 端点）
  - 发布说明 URL 的校验规则（shared-contracts 中的运行时 schema）
  - Release 下载 URL 前缀校验
  - 设置页的仓库、Issue、Windows 手动下载链接
  - 原生启动器在需要引导用户下载时的 latest release 回退地址
  - npm 包元数据（repository、bugs、homepage）
  - npm 安装后提示中的仓库地址
- npm 包：主包 `@chinhae/codex-connect`，平台包 `@chinhae/codex-connect-{darwin-arm64,darwin-x64,win32-x64,win32-arm64,linux-x64,linux-arm64}`。npm keywords 中的产品名同步更新。发布脚本内的包名、命令名、仓库地址、keywords、tarball 基名集中在 `scripts/release/prepare-npm.mjs` 的 `NPM_*` 常量，npm 包内所有展示命令的文案都从这些常量派生。Renderer（`CODEXHOST_NPM_MANUAL_UPDATE_COMMAND`）和 Rust 更新器（`NPM_PACKAGE_NAME`）因边界限制各持一份字面量，分别由设置页渲染测试和 `npm_package_spec` 单测断言。
- 发布产物：`codex-connect-<version>-<target>.{dmg,exe}`，npm tarball 名随包名变化，为 `chinhae-codex-connect-<version>[-<target>].tgz`；发布流水线中的产物匹配模式与上传文件列表同步修改。流水线结构（OIDC、provenance、校验步骤）不变。

**跨 Harness 委派的调用方式（实现期间决定）**

- 原先 Agent 指令依赖 PATH 中的 `codexhost` 命令，npm 命令改名后，这条路径对 npm 用户失效。现在托管委派 Skill（升到 v8，并登记 v7 摘要以便自动升级）、CLI 帮助、`#` 提及指令、`next.read/wait` 提示和未知命令报错，都改为通过 Host 注入的 `CODEXHOST_CLI_PATH` 调用：POSIX 写作 `"$CODEXHOST_CLI_PATH"`，PowerShell 写作 `& $env:CODEXHOST_CLI_PATH`。帮助里的 `include_only` 建议包含 `CODEXHOST_CLI_PATH`。
- 已知退化：远程 SSH Host 不注入 `CODEXHOST_CLI_PATH`，远程会话里的委派在第 07 票完成前不可用。

**与上游的替代关系（机器标识不变）**

- 数据目录 `~/.codexhost` 与 `CODEXHOST_DATA_DIR` 不变。
- macOS bundle id `com.codexhost.app` 不变，只改 `CFBundleName`/`CFBundleDisplayName` 和 `.app` 名称。可执行文件名与图标文件名随 slug 变化与否属于实现细节，但不能改变 bundle id。
- LaunchAgent 标签 `ai.bytepioneer.codexhost.*` 不变（包括 Claude Code 的旧 Label 兼容语义）。
- Windows `AppId` GUID 不变，从而覆盖升级上游安装；`AppName`/`AppPublisher` 改为 `Codex Connect`，新安装的默认目录为 `Programs\codex-connect`。

**图标**

- 源图为 1024×1024、带透明圆角留边的 macOS 规范图标（全息双括号），替换启动器资源中的品牌 PNG，并用现有脚本重新生成多尺寸 `.ico`；macOS 打包仍从这张 PNG 生成 `.icns` 与 DMG 卷图标。
- 应用内的设置品牌图标（设置页头部、标题栏设置按钮）改为新图标的位图，以 data URL 内联进 Renderer bundle（保持 Renderer 不依赖网络和本地路径）。完成后用实际 Desktop 检查小尺寸效果；如果不可辨认，改为按新图标形状绘制的简化矢量版。
- 资源说明文档中关于品牌图标来源的描述同步更新。

**"关于"页面与署名**

- 简介与"开源地址"文案中的产品名改为 Codex Connect，开源地址为 `LFT-OXY/Codex-Connect`。
- 在"开源地址"下方新增一行：中文"基于开源项目 codex-host 开发"，英文对应文案，链接到 `https://github.com/BytePioneer-AI/codex-host`。
- `LICENSE`（LGPL-3.0）及其中的版权声明保持不变。

**README（英文与简体中文同步）**

- 标题、简介、正文中的产品名改为 Codex Connect。
- 保留 Star 提示并指向本仓库；删除 Star History、微信群二维码与 Join the Community 一节，以及导航中对应的锚点；删除韩文 README 及其导航链接。
- 下载链接与 `git clone` 地址改为本仓库；Quick Start 的 npm 命令改为 `@chinhae/codex-connect` 与 `codex-connect`。
- Interface Preview 之后新增"新特性"一节，共两项（Model 与思考选项拆分为独立药丸；思考强度滑块胶囊样式、连续拖动与吸附、光泽流动动画），不写成"Fork 新增"，暂不配截图。
- Quick Start 末尾新增折叠的"如果之前装过 codexhost"：卸载 `@codexhost/cli` 或删除 `codexhost.app`，会话数据自动沿用。
- Acknowledgements 首条：`Codex Connect is built on [codex-host](https://github.com/BytePioneer-AI/codex-host). Thanks to its authors and contributors.`（中文版对应翻译）；保留 Paseo，删除 LINUX DO。
- README 中引用的截图文件名（含 codexhost 字样）属于内部资源名，不改。

**不改的内容**

- 历史文档（设计提案、已归档的 openspec 变更、`docs/archive/`、运维文档里的历史 PR/Issue 链接）中的上游链接保留。
- 开发预览页（`*.preview.html`）中的上游链接随源码一起更新。
- 版本号不在本任务中修改。

## Testing Decisions

**好测试的标准**：只断言对外可观察的行为，例如更新发现请求的端点、接受或拒绝哪些发布 URL、设置页渲染出的链接与文案、npm 包清单中的名称和元数据、打包脚本生成的 Info.plist 与安装器字段、产物文件名。不断言内部常量名或实现结构。

**测试接缝（1–6 沿用现有接缝，7 为唯一新增）**：

1. **更新发现**：update-manager 的 GitHub Release 解析（API 与 CLI 两条路径）。断言请求本仓库的端点、接受本仓库的 release/download URL、拒绝上游仓库的 URL。沿用现有的 github-release 测试。
2. **更新契约**：shared-contracts 的更新 schema。断言本仓库的发布说明 URL 通过校验、上游 URL 被拒绝。沿用现有的 updates 测试。
3. **设置页渲染**：renderer-extension 的设置页（关于页、更新页、连接页的 Issue 入口、Windows 手动下载链接、发布说明链接）。断言渲染出的 href 与产品名文案，并新增断言上游署名链接存在。沿用现有的 settings pages 测试和 release-notes 测试。
4. **发布打包**：tests/release 中的 npm 包、npm 发布、payload、打包器测试。断言包名、bin 名、仓库元数据、安装后 Star 提示、产物文件名、Info.plist 显示名与不变的 bundle id、Installer 的 AppName 与不变的 AppId。沿用现有测试。
5. **Host 运行时与 renderer 客户端**：host-runtime 的 update-coordinator 与投影测试、renderer-model-client 测试中的 fixture URL 同步改为本仓库，保证整条更新链路的 fixture 一致。
6. **Rust 启动器**：原生启动器的 latest release 回退地址如果已有测试覆盖，就同步更新；没有测试就不新增。

7. **品牌守卫（唯一新增接缝）**：新增一个测试，扫描面向用户的源码（本地化文案、设置页、Harness 安装引导、发布脚本、Rust 平台层与启动器的用户可见输出、README 与简体中文 README），断言：
   - 不含上游仓库地址 `BytePioneer-AI/codex-host`。唯一例外是"关于"页和 README 致谢中的上游署名链接，这两处必须恰好存在。
   - 不含面向用户的 `codexhost` / `CodexHost` 产品名。内部标识符（包名、协议方法、环境变量、CSS 类名、数据目录、bundle id、LaunchAgent 标签、内部二进制名）按显式白名单放行。
   - 白名单与被扫描的文件范围写在测试内，逐条注明理由。合并上游后如有新增误报，由维护者判断是改文案还是扩白名单。

**验证方式**：运行受影响包的聚焦测试（按 `tests/vitest.config.js`）、`npm run typecheck`、`npm run lint`（含边界检查）、受影响 crate 的 `cargo test`；最后用 `npm start` 启动一次，人工检查设置页图标、关于页文案和署名链接。不默认跑全量测试。

## Out of Scope

- 修改数据目录、bundle id、Windows AppId、LaunchAgent 标签等机器标识。
- 重命名 workspace 包、crate、协议方法、环境变量、CSS 类名、内部 skill 名。
- 改写内部设计文档、归档文档、openspec 历史中的产品名与链接。
- 修改版本号或实际执行一次发布。
- 在 npmjs 上创建包或配置 Trusted Publisher（首次发布时由维护者处理）。
- 为 README"新特性"一节补充截图。
- 为发布流水线新增 `NPM_TOKEN` 回退。

## Further Notes

- 访谈的完整决策记录见 `research/interview-decisions.md`。
- 长期同步上游的风险：上游新增的本地化文案、设置页链接、发布脚本改动可能重新带回 `codexhost` 产品名或上游仓库地址。品牌守卫测试负责在合并后拦住这种回退。
- macOS 上从 codexhost 切换的用户会同时留有 `codexhost.app` 与 `Codex Connect.app`（bundle id 相同），README 的迁移说明提示删除旧 app。
- 原生 Rust 层的 usage 文字（`crates/launcher/src/main.rs`、`native_harness_broker.rs`）以原生二进制名 `codexhost` 书写。npm 用户经 `codex-connect broker …` 传错参数时会看到这个名字，由第 04 票判断是否调整。
- 第 02 票注意：Rust 更新器的 macOS DMG 安装路径按 `codexhost.app` 在 DMG 内查找应用（`crates/updater/src/install.rs`），`.app` 改名时要同步修改。
- 首次 npm 发布前，需要在 npmjs 上为 7 个包配置指向 `LFT-OXY/Codex-Connect` 的 `release-packages.yml` 的 Trusted Publisher；如果 npm 要求包先存在才能配置，就需要在本地手动首发一次。
