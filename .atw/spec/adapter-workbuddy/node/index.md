# adapter-workbuddy（Node）

> 通用约定见 `.atw/spec/adapters/node/index.md`（plugin.ts 工厂、manifest、HarnessResult、command.ts、测试组织等）。本目录只写 WorkBuddy 特有内容。

`@codexhost/adapter-workbuddy` 运行 WorkBuddy AI App 自带的 CLI。该 CLI 本身就是 CodeBuddy CLI（macOS 路径 `…/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy`），通过同样的 `--acp` 接口提供服务，只是产品配置和数据根换成了 WorkBuddy 的。

## 与 adapter-codebuddy 的关系（实现是共享的）

本包**没有自己的协议实现**。ACP 客户端、Session、历史投影、Fork/修订派生、审批/问题、子 Agent 全部来自 `@codexhost/adapter-codebuddy`（`package.json` 依赖、`tsconfig.json` references `../codebuddy`）。本包只提供四样东西：

| 文件 | 提供的差异 |
|---|---|
| `src/common.ts` | `WORKBUDDY_RUNTIME_PROFILE`：`harnessId: "workbuddy"`、配置根 `WORKBUDDY_CONFIG_DIR` / `~/.workbuddy-ai`、保留大小写和 Unicode 的项目目录编码、静态命令目录（`/compact`、`/init`）、`historyCapabilities: { fork: true, forkAcrossCwd: true, rollbackLastTurn: true }` |
| `src/command.ts` + `src/discovery.ts` | `workBuddyInvocation`：只在 App 安装目录内查找 Electron 运行时和内置 CLI，并组装子进程环境 |
| `src/product-models.ts` | Windows 专用：从产品快照补充 CLI Model 目录 |
| `src/workbuddy-adapter.ts` | `class WorkBuddyAdapter extends CodeBuddyAdapter`，注入 Profile、invocation 与 clientFactory，并覆写 `inspect` 来合并产品 Model |

`src/delegation.ts` 对应 CodeBuddy `command.ts` 里的委派提示词，提示词文本换成了 WorkBuddy 的版本。

**规则**：WorkBuddy 的行为差异必须通过 `CodeBuddyRuntimeProfile` 字段或 invocation/client 工厂注入，不要复制 CodeBuddy 的 Session/历史代码到本包，也不要在 CodeBuddy 源码里判断 `harnessId === "workbuddy"`。需要新的差异点时，先在 `CodeBuddyRuntimeProfile`（`codebuddy/src/common.ts`）加可选字段，由 CodeBuddy 读取它，再由本包设置。

## 发现与启动（`command.ts`、`discovery.ts`）

- 默认 `command` 是绝对路径 `WORKBUDDY_MACOS_ELECTRON`，这是有意设计，用来防止从 PATH 找到无关的 `codebuddy`（`workBuddyDiscoverySpec` 注释）。`resolveWorkBuddyBundle` 只接受同一安装目录内的“运行时 + 脚本”配对：macOS 只认 install-root 来源，Windows 只认 `.exe`（`.cmd` shim 不是 Electron）。
- Linux 没有已确认的 App 布局，因此不做自动发现。未设置 `CODEXHOST_WORKBUDDY_COMMAND` 时直接报 `notInstalled`。
- `CODEXHOST_WORKBUDDY_COMMAND` 可以是安装目录、独立 CLI，或 Desktop 入口（`WorkBuddy*.exe` / `…app/Contents/MacOS/Electron`）。指定 Desktop 入口时仍需找到同目录下的内置 CLI；找不到就失败，不回退到其他安装。manifest 的 `launchCommand: true` 让设置页的路径经 `context.launchCommand` 传入（`plugin.ts`）。
- 使用内置 CLI 时设置 `ELECTRON_RUN_AS_NODE=1`，并把 `[bundle.cli, ...args]` 交给 Electron 执行。

## 数据隔离与产品快照

- `workBuddyEnvironment` 把 `CODEBUDDY_CONFIG_DIR` 和 `WORKBUDDY_CONFIG_DIR` **强制设为同一个 WorkBuddy 根**。内置 CLI 读取的是 `CODEBUDDY_CONFIG_DIR`，如果不这样做，用户给 CodeBuddy 配置的根目录会让两个产品的历史和认证串在一起。同时默认设置 `DISABLE_AUTOUPDATER=1`。
- `bundledProductConfigPath`：调用方没有显式设置 `ACC_PRODUCT_CONFIG_PATH` 或 `ACC_PRODUCT_CONFIG[_V2|_V3]` 时，才会把 `<root>/cache/acc-product-config-v3.json` 通过 `ACC_PRODUCT_CONFIG_PATH` 传下去。前提是根目录和 cache 都是非符号链接目录，文件非空且不是符号链接；POSIX 上还要求属主是当前用户、目录对组和其他用户不可写（`mode & 0o022` 为 0）、文件对组和其他用户不可访问（`mode & 0o077` 为 0）。显式指定独立 CLI 时不推断这份私有缓存。
- 无模型复制阶段（参数同时含 `--print` 和 `--fork-session`）默认加 `DISABLE_TELEMETRY=1`，避免等待遥测通道；调用方已设置的值保持不变。
- 不读取、不复制 WorkBuddy Desktop 的登录态，也不调用 `_codebuddy.ai/activateWorkbuddyOwnerRuntime` 等 owner runtime 私有接口（`docs/harnesses/workbuddy/workbuddy-harness-integration.md` 的“Desktop 私有运行时边界”）。ACP 报认证失败时，让用户用同一个数据根启动内置 TUI 执行 `/login`。

## 平台差异（都集中在 `WorkBuddyAdapter` 构造函数）

- **Windows**：Profile 额外设置 `allowUnlistedModelSelection: true`，并且 `inspect` 会把 `loadWorkBuddyProductModels` 读到的 CLI Model 追加到 ACP 目录后面。只取 `agents[name="cli"].models` 中列出的 ID，按原生 ID 和规范化显示名去重，ACP 原生 Model 排在前面；`credits` 仅作为标签后缀显示。
- **macOS / 其他平台**：`productModels` 固定返回 `[]`，完全使用 ACP 原生目录。
- 产品快照读取失败一律返回 `[]`，不影响 inspect；快照文件上限 8 MB。

## 已知状态与坑

- 跨目录 Fork 会把临时复制品以桥接文件形式写入目标项目。CLI 在**源项目**里创建的临时复制品没有公开的删除接口，可能残留在 WorkBuddy 数据目录中；适配器不会绕过原生所有权去删它（集成文档“Fork、跨目录 Fork 与修订边界”）。
- 集成文档记录了一个未定位的问题：“取消 → 继续 → 递归 Fork → 关闭后恢复原分支”这一组合下，Host Turn 在 60 秒内没有结束。修改取消恢复或派生流程时，要把这个组合纳入验证。
- `WorkBuddyAdapter.open` 重复了 `CodeBuddyAdapter.open` 里“无人值守必须使用 fullAccess”的检查，只是报错前缀不同（`WorkBuddy: …`）。它在调用 super 之前就会返回，不要再加第三处同样的检查。
- 跨 Harness 委派已经接线（`workBuddyDelegationArguments`），但 README 未标记为支持，因为还没有做已登录状态下的递归验收。

## 改动前检查清单

1. 先确认改动应该放在哪里：只影响 WorkBuddy 的，放 Profile 字段或本包工厂；影响 ACP/历史语义的，改 `adapter-codebuddy`，并同时运行两个包的测试。
2. 修改发现逻辑时，保持“同一安装目录配对”和“不查找 PATH 中的 codebuddy”，并补充 `test/discovery.test.ts`，同时覆盖 macOS / Windows 的路径形态。
3. 修改环境组装时，确认 `CODEBUDDY_CONFIG_DIR` 仍被覆盖为 WorkBuddy 根（`test/command.test.ts`、`test/discovery.test.ts`、`test/workbuddy-adapter.test.ts`）。
4. 修改 Model 目录时，区分平台：只有 Windows 使用产品快照补充，macOS 保持 ACP 原生目录（`test/product-models.test.ts`、`test/workbuddy-adapter.test.ts`）。
5. 修改项目目录编码（`projectDirectoryName`）时，用独立的原生目录样本做回归，不要用被测函数生成期望值（集成文档“工作目录与原生历史定位”）。

## 定向验证

```sh
npm run build:typescript   # 测试按包名导入 @codexhost/adapter-codebuddy 的 dist
npx vitest run --config tests/vitest.config.js packages/adapters/workbuddy/test
```

`test/history-derivation.test.ts` 覆盖同目录 / 跨目录 Fork、修订、子 Transcript 复制和权限位；`test/plugin-delegation.test.ts` 通过 `startHarnessBrokerServer` 验证 Broker 路径下的环境转发。
