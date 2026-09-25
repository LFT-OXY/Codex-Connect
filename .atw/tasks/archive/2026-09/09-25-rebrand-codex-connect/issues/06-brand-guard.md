# 06 — 品牌守卫测试

**What to build:** 维护者合并上游后运行测试，若面向用户的源码或 README 重新出现上游仓库地址或用户可见的 codexhost 产品名，测试失败并指出位置，从而防止品牌悄悄回退。

**Blocked by:** 01、02、03、04、05
**Status:** ready-for-agent
**Impl:** done

- [x] 扫描范围覆盖：本地化文案、设置页、Harness 安装引导、发布脚本、Rust 平台层与启动器的用户可见输出、英文与简体中文 README
- [x] 扫描范围还包括给 Agent 的委派命令文案（host-runtime 的 `delegation-skill.ts`、`delegation-cli-help.ts`、`delegation-cli.ts`、`delegation-mention-rewrite.ts`、`app-server-host.ts`、`harness-delegation-coordinator.ts`，以及 `remote-host-cli.ts`、`remote-host-lifecycle.ts`）：`codexhost delegate|thread|harness|remote` 这类命令调用不在"内部二进制名"白名单内，必须写成 `codex-connect`
- [x] 上游仓库地址只允许出现在"关于"页署名与 README 致谢，且这两处必须存在
- [x] 面向用户的 `codexhost` / `CodexHost` 产品名被拒绝；内部标识符（包名、协议方法、环境变量、CSS 类名、数据目录、bundle id、LaunchAgent 标签、内部二进制名、stderr 诊断日志前缀）按显式白名单放行，每条注明理由
- [x] 测试纳入现有测试配置，可用聚焦命令单独运行
- [x] 当前代码下测试通过；人为改回一处上游链接或产品名时测试失败，失败信息指出文件与内容

**第 04 票留下的白名单候选（诊断输出，保留 codexhost）：** `renderer-extension/src/settings/connections-page.ts` 中复制用的诊断文本标题 `codexhost connection diagnostics`；Rust 启动器中描述内部组件的错误正文（如 `did not start the codexhost Host chain`、`codexhost control endpoint …`）；`desktop-control/src/renderer-draft-prewarm-runtime.ts` 中 PowerShell 诊断报错 `CodexHost Remote Control runtime is not running`（驼峰写法，需判断是否纳入扫描）。

**实现备注：**

- 守卫为单个测试文件 `tools/brand-guard.test.mjs`，纳入 `tests/vitest.config.js` 的 `tools/**/*.test.mjs`。聚焦运行：`npx vitest run --config tests/vitest.config.js tools/brand-guard.test.mjs`。
- 扫描方式：
  - TS/MJS 用 TypeScript 解析器提取字符串与模板字面量，插值记为 `${}`。
  - Rust 用简易词法器提取字符串字面量，跳过注释、`#[cfg(test)]`/`#[cfg(all(test, …))]` 项与 `*_tests.rs`。
  - `.sh`/`.iss`/`.ps1` 与 README 整文件扫描，脚本的整行注释会被抹去。
- 产品名检测 `codexhost`、`CodexHost`、`Codex Host`，不分大小写。
- 白名单分两类：
  - 不可能是文案的机器标识形状（`CODEXHOST_*`、`@codexhost/*` 但不含 `@codexhost/cli*`、`~/.codexhost`、LaunchAgent 标签、bundle id、`codexhost-settings-*`、`--codexhost-*`、固定后缀的内部二进制、Skill、资源名）对所有文件生效。
  - 诊断前缀、内部组件错误正文、协议方法、裸 `codexhost` 机器标识、可执行后缀拼接等，按文件限定在实际出现处，本地化文案与 README 不受其放行。
- README 迁移说明块只放行 summary、"replaces/用于替代 codexhost"、`@codexhost/cli`、`/codexhost.app`，块内其他产品名仍会被拒绝。
- 上游地址分两种：
  - 署名形态：`pages.ts` 中恰为上游 URL 的字面量；README 中的 `[codex-host](https://github.com/BytePioneer-AI/codex-host)`。三个文件必须各恰好一处。
  - 其他任何出现都逐条报告"文件:行: 内容"。
- 守卫拦下的 3 处用户可见文案已改为 Codex Connect：
  - `remote-host-cli.ts` 的 `remote --help` 描述句
  - `prepare-payload.mjs` 的第三方声明标题
  - `prepare-npm.mjs` 的第三方声明标题
- 已人为验证：把设置页下载链接改回上游、把一处本地化文案改回 codexhost，测试会失败并给出文件、行号和内容。
- 桌面控制包 `desktop-control` 中的 PowerShell 诊断 `CodexHost Remote Control runtime is not running` 不在扫描范围内，它属于诊断输出。`crates/launcher/windows.manifest` 的 `<description>` 是程序集元数据，不向用户展示，也不扫描。
- 追加扫描应用内更新链路：`packages/update-manager/src/*.ts` 与 `crates/updater/src/*.rs`。更新失败原因会写进更新状态，由设置页 `pages.ts` 原样显示。
  - 已改为 Codex Connect：`updated … did not become ready after relaunch` 与 npm 启动器标签 `npm … launcher`。
  - 保留 codexhost：更新器请求校验阶段的同名标签。这个阶段还没写更新状态，报错只进 stderr。
- 追加扫描 Harness Adapter：`packages/adapters/*/src/**/*.ts`（用户决定改名，不登记为例外）。
  - 已改为 Codex Connect：Antigravity 的权限模式说明与问答报错；DeepSeek Harness 的连接和 Fork 报错（测试断言同步）；Cursor 的"不支持此扩展"；CodeBuddy、WorkBuddy、Hermes 的委派提示与 Hermes 委派 Skill 描述；Pi 写入用户扩展目录的文件头注释。
  - Pi 按 `import.json` 中保存的副本判断文件归属，改模板不影响已有导入。
  - 保留 codexhost 的机器标识（按 Adapter 限定的白名单）：ACP `clientInfo.name`、OpenCode 服务端认证用户名、RPC 请求 id 前缀、临时与日志文件名、`codexhost.ask_question` Hook 工具名、Hermes `codexhost-runtime` 插件名、`codexhost.selection.v1`、`codexhostImportId`、Claude Code SDK 客户端标识。
