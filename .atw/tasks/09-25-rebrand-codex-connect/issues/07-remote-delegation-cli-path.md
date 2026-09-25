# 07 — 远程 SSH 会话的委派 CLI 路径注入

**What to build:** 在远程 SSH Host 上运行的 Codex 会话里，Agent 按委派 Skill 执行 `"$CODEXHOST_CLI_PATH" delegate …` 时能找到 CLI。第 01 票把委派指令改为经 `CODEXHOST_CLI_PATH` 调用，但远程 Host 的两条启动路径（`remote start` 的 `managedEnvironment`，以及 SSH 直接执行的 `codex` 包装脚本）都不注入该变量，远程委派因此不可用。

**Blocked by:** 01 — npm 安装与 CLI 命令改为 Codex Connect
**Status:** ready-for-agent
**Impl:** ready

- [ ] `remote install` 把 npm CLI（`bin/codex-connect.js`）的绝对路径写入远程清单（`RemoteHostManifestV1`），并纳入清单校验与 degraded 判定
- [ ] 包装脚本 `export CODEXHOST_CLI_PATH`，`managedEnvironment` 同样注入；两条启动路径的远程会话都能拿到该变量
- [ ] 旧清单（缺该字段）的远端给出明确的"重新执行 `codex-connect remote install`"提示，不静默失效
- [ ] remote-host-install / remote-host-lifecycle 受影响测试更新并通过，新增断言覆盖包装脚本导出与清单字段
