# 01 — npm 安装与 CLI 命令改为 Codex Connect

**What to build:** 用户执行 `npm install -g @chinhae/codex-connect` 安装后，用 `codex-connect` 启动 Codex Connect；安装完成的提示把 Star 链接指向 `LFT-OXY/Codex-Connect`；npm 包页面上的仓库、Issue、主页链接指向本仓库；应用内通过 npm 执行的自动更新和设置页显示的手动更新命令都使用新包名，不会再安装上游的 `@codexhost/cli`。

**Blocked by:** None — can start immediately
**Status:** ready-for-agent
**Impl:** done

- [x] 主包名为 `@chinhae/codex-connect`，6 个平台包为 `@chinhae/codex-connect-{darwin-arm64,darwin-x64,win32-x64,win32-arm64,linux-x64,linux-arm64}`
- [x] 安装后可执行命令为 `codex-connect`（npm 主包 `bin`）；原生二进制 `bin/codexhost`、`codexhost-start.exe` 按实现期间的决定保持内部名
- [x] 跨 Harness 委派的 Agent 指令中的命令名改为 `codex-connect`（沿用上游按命令名调用的设计），托管 Skill 升版本并登记旧摘要
- [x] npm 元数据中的 repository、bugs、homepage 指向 `LFT-OXY/Codex-Connect`；keywords 中的产品名更新
- [x] npm 安装后的提示（中英文）保留 Star 文案，仓库地址为本仓库，产品名为 Codex Connect（提示原文不含产品名，无需改动）
- [x] Rust 更新器的 npm 更新路径安装 `@chinhae/codex-connect`
- [x] 设置页展示的手动更新命令为 `npm install -g @chinhae/codex-connect@latest`
- [x] 发布工作流中的 npm tarball 匹配与上传模式随新包名更新；OIDC 与 provenance 结构不变
- [x] 数据目录 `~/.codexhost` 与 `CODEXHOST_*` 环境变量不变
- [x] 受影响的 tests/release npm 测试与 updater crate 测试已更新并通过
