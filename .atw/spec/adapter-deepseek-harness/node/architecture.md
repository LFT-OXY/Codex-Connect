# DSH：架构、代际选择与版本 Profile

## “modern 与 legacy”：legacy 已删除

`src/modern/` 这个目录名和各处的 `Modern*` 前缀，是从 Legacy 实现与 Modern 实现并存的时期沿用下来的。Legacy 先在 `1d4d5f9c`（refactor: 隔离 Legacy Host Adapter）中被隔离，随后在 `da47594d`（feat(deepseek): 对接 012/015 RC 协议并移除 Legacy）中连同 SDK 和专属测试一起删除（`docs/harnesses/deepseek/dsh-015rc1-validation.md`：“旧 DSH Legacy 实现、SDK 和专属测试已删除”）。

**现在只有一条运行时路径**：外层门面 → `ModernDeepSeekHarnessAdapter` → 托管的 `dsh web` Remote。`DeepSeekProtocolGeneration` 类型只剩 `"modern"`。`docs/archive/deepseek-integration/deepseek-harness-integration-analysis.md` 描述的 JSON-RPC SDK / Cordis 方案只是历史分析，不要依据它写代码，也不要重新引入第二条协议路径。

## 分层

```
src/plugin.ts                     createHarnessAdapter → DeepSeekHarnessAdapter
src/deepseek-harness-adapter.ts   外层门面：延迟选择、失败缓存、关闭编排、sessionImport/webUi 转发
src/generation-selector.ts        `--version` 探测、端点校验、外部 Web 实例指纹检测
src/executable.ts                 dsh / npx 解析、Windows .cmd 包装、进程树终止
src/profiles/                     按 DSH 版本区分的原生日志格式（V0 / V3 / V4）
src/modern/                       唯一的运行时实现（Remote、控制投影、事件网关、日志、Session）
src/{model-catalog,projection,harness-commands}.ts  modern/ 共用的纯函数（Model Ref、Tool/Usage 投影、命令目录）
```

根目录下这几个文件不是“旧路径”，而是 `modern/*` 在用的公共模块（`modern/history.ts` 和 `modern/session.ts` 会导入 `../projection.js`、`../model-catalog.js`、`../harness-commands.js`）。

## 外层门面（`deepseek-harness-adapter.ts`）

- 构造时不启动任何进程。第一次调用 `inspect` / `open` / `sessionImport` 时，`#select` 才创建唯一的委托对象，并发调用共享同一个 `#selection` Promise。
- 选择顺序（`#performSelection`）：`parseDeepSeekEndpoint` → 探测可执行文件版本 → `hasDeepSeekModernAuthenticationFingerprint`（若配置的端点上已有 DSH Web 在运行，而本实例拿不到它的凭据，就报 `authenticationRequired`，诊断信息为 `externalModernWeb`）→ 创建 `ModernDeepSeekHarnessAdapter` 并执行 `inspect`，只有 inspect 结果为 `ready` 才采用这个委托。
- 失败会缓存到 `#failure`，只有 `inspect({ refresh: true })` 才会重新选择。**清理失败是终态**（`#terminalFailure`）：探测或候选进程没能关掉时，之后所有调用都返回同一个错误，不再重试。
- 错误统一带上 `stage`（`resolve-executable` / `version` / `wire-handshake` / `startup` / `cleanup`）和 `durationMs`，供连接诊断使用。新增失败路径时也要补上 stage。
- 依赖注入：`DeepSeekHarnessAdapterDependencies`（`probeExecutable`、`createModernAdapter`）。门面的测试不启动真实进程。

## 可执行文件与版本探测

- `resolveDeepSeekCommand`（`executable.ts`）：先用配置的命令，其次在 PATH 中找 `dsh`，最后用 `npx --offline --no-install @deepseek-ai/dsh`。配置的命令找不到时返回 `null`，**不回退**到 PATH。`npx` 以非零码退出时报 `notInstalled`（`generation-selector.ts` 的 `onClose`）。
- Windows 下的 `.cmd` / `.bat` 由 `deepSeekProcessInvocation` 包装成 `cmd.exe /d /v:off /s /c "…"`，参数中的 `%` 和 `"` 会转义，并使用 `windowsVerbatimArguments`。要等所有参数拼好之后再包装（`ModernRemoteConnectionOptions.command` 注释）。
- `--version` 的 stdout 必须恰好是一行规范 SemVer；输出上限 16 KB，超时 5s。stderr 先经 `filterAmbientNodeWarnings` 去掉 Node 的 `[UNDICI-EHPA]` 这类环境警告（macOS Broker 开启 `NODE_USE_ENV_PROXY` 时会出现），过滤后还有剩余内容就报 `protocolError`。
- **版本不再按白名单拒绝**：只要是 SemVer 就尝试连接，然后由 Remote、历史和流的严格解析器来判断是否兼容（提交 `daaef03b`，文档“连接版本策略”一节）。

## 版本 Profile（`profiles/profile.ts` 的 `deepSeekModernProfile`）

| 版本 | Profile | 日志格式 | checkpoint 前缀 | Assistant 流 |
|---|---|---|---|---|
| `0.1.2` 系列（`/^0\.1\.2(?:-\|\+\|$)/`） | `DEEPSEEK_V012_PROFILE` | V0 | `turn-end:` | 否（持久化 chunk） |
| 精确 `0.1.7-rc.1` | `DEEPSEEK_V017_PROFILE` | V4 | `v4-turn-end:` | 是 |
| 其余所有 SemVer | `DEEPSEEK_V015_PROFILE` | V3 | `v3-turn-end:` | 是 |

- 只有这个经过验证的 V4 标签会选到 V4；未知版本一律按 V3 严格准入（源码注释）。支持新的 DSH 版本时，先确认它的日志格式，再决定是复用现有 Profile，还是新增 `profiles/vXYZ.ts`，并在 `deepSeekModernProfile` 中精确匹配。
- Profile 是纯数据加解析函数（`parseHeader`、`parseHistoryRecord`、`parseLiveItem`、`validateEvent`、`matchesForkTail`、`inheritedEventCount`……）。V4 基于 V3 展开（`{ ...DEEPSEEK_V015_PROFILE, … }`），只覆盖有差异的部分。
- `hasDeepSeekModernStream(profile)`（格式 ≥ 3）同时决定三件事：Native Ref / checkpoint 是否带 `locator: { dshVersion }`、是否需要 `flushSession`、是否清理 Fork 继承的队列。
- 已验证版本见 `docs/harnesses/deepseek/dsh-edit-recovery.md` 顶部的表格。设置 → 连接页面只把这五个版本标为“已测试”，未测试的版本不宣称兼容。
