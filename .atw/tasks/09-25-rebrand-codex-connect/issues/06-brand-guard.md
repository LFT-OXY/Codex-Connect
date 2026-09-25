# 06 — 品牌守卫测试

**What to build:** 维护者合并上游后运行测试，若面向用户的源码或 README 重新出现上游仓库地址或用户可见的 codexhost 产品名，测试失败并指出位置，从而防止品牌悄悄回退。

**Blocked by:** 01、02、03、04、05
**Status:** ready-for-agent
**Impl:** ready

- [ ] 扫描范围覆盖：本地化文案、设置页、Harness 安装引导、发布脚本、Rust 平台层与启动器的用户可见输出、英文与简体中文 README
- [ ] 扫描范围还包括给 Agent 的委派命令文案（host-runtime 的 `delegation-skill.ts`、`delegation-cli-help.ts`、`delegation-cli.ts`、`delegation-mention-rewrite.ts`、`app-server-host.ts`、`harness-delegation-coordinator.ts`，以及 `remote-host-cli.ts`、`remote-host-lifecycle.ts`）：`codexhost delegate|thread|harness|remote` 这类命令调用不在"内部二进制名"白名单内，必须写成 `codex-connect`
- [ ] 上游仓库地址只允许出现在"关于"页署名与 README 致谢，且这两处必须存在
- [ ] 面向用户的 `codexhost` / `CodexHost` 产品名被拒绝；内部标识符（包名、协议方法、环境变量、CSS 类名、数据目录、bundle id、LaunchAgent 标签、内部二进制名、stderr 诊断日志前缀）按显式白名单放行，每条注明理由
- [ ] 测试纳入现有测试配置，可用聚焦命令单独运行
- [ ] 当前代码下测试通过；人为改回一处上游链接或产品名时测试失败，失败信息指出文件与内容

**第 04 票留下的白名单候选（诊断输出，保留 codexhost）：** `renderer-extension/src/settings/connections-page.ts` 中复制用的诊断文本标题 `codexhost connection diagnostics`；Rust 启动器中描述内部组件的错误正文（如 `did not start the codexhost Host chain`、`codexhost control endpoint …`）；`desktop-control/src/renderer-draft-prewarm-runtime.ts` 中 PowerShell 诊断报错 `CodexHost Remote Control runtime is not running`（驼峰写法，需判断是否纳入扫描）。
