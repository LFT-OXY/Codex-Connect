# 插件包结构、工厂与发现

## 目录形态

```
packages/adapters/<name>/
  manifest.json      # 插件身份，按 shared-contracts 的 schema 校验
  assets/icon.svg    # 可选；grok、opencode 用 icon.png；deepseek-harness、hermes、kimi-code 没有图标
  package.json       # name=@codexhost/adapter-<name>，exports 含 "./plugin" 与 "."
  tsconfig.json      # references 至少含 shared-contracts、harness-adapter（CLI 类再加 harness-discovery）
  src/plugin.ts      # 工厂入口，Loader 只认它
  src/index.ts       # 包的公开导出，供测试和兄弟包用，不是 Loader 入口
  src/command.ts     # 可执行文件发现（deepseek-harness 叫 executable.ts，qoder 叫 qoder-command.ts）
  src/<name>-adapter.ts / *-session.ts / *-transport.ts / *-history.ts / models.ts / permission-modes.ts ...
  test/*.test.ts
```

- `package.json#files` 固定为 `["dist", "manifest.json", "assets"]`，`private: true`，15 个包都一致。除 `cursor-cli` 外，其余包都有 `"build": "tsc -b"` 脚本；实际编译由根目录 `tsc -b` 通过 project references 完成，所以缺少这个脚本不影响构建。
- 新包还要加入根 `tsconfig.json#references`（根 `package.json#workspaces` 已用 `packages/adapters/*` 通配，不用改）。
- 文件按职责拆，不照抄其他 Adapter 的文件数量。Pi 的 Adapter 和 Session 在同一文件（`pi-adapter.ts`）；Kimi 分成 `kimi-adapter.ts` + `kimi-session.ts`；Qoder 的 Session 在 `qoder-sdk-transport.ts`。

## manifest.json

Schema：`packages/shared-contracts/src/harness-plugins.ts` 的 `harnessPluginManifestSchema`（`.strict()`，多余字段直接失败）。仓库内的写法：

```json
{ "manifestVersion": 1, "id": "pi", "name": "Pi", "version": "0.0.0",
  "adapterApiVersion": 1, "entry": "./dist/plugin.js", "icon": "./assets/icon.svg",
  "links": { "installation": "https://pi.dev/" } }
```

- `id` 必须等于 Adapter 的 `harnessId`、`NativeSessionRef.harnessId`，匹配 `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`，`codex` 保留。
- `adapterApiVersion` 与 `HARNESS_PLUGIN_API_VERSION`（当前 1）精确匹配；不要把它和插件自身 `version` 混用。
- `links` 只允许 `documentation` / `installation`，且必须是不带凭据的 HTTPS。
- **Manifest 只是数据**：不要在里面写能力、命令名或环境变量。能力来自 `inspect()` 和 Session `capabilities`；命令目录来自 `HarnessAdapter.commandCatalog`。
- `launchCommand: true` 只有 `workbuddy` 声明，工厂从 `context.launchCommand` 读用户在设置页保存的安装目录。

## src/plugin.ts：工厂

契约在 `packages/harness-adapter/src/plugin.ts`（`HarnessPluginModule`）。主流写法（pi、grok、opencode、omp、kiro-cli、antigravity、hermes 相同）：

```ts
export const PI_COMMAND_ENV = "CODEXHOST_PI_COMMAND";
export function createHarnessAdapter(context: HarnessPluginContext): PiAdapter {
  const environment = { ...context.environment };
  return new PiAdapter({
    ...(environment[PI_COMMAND_ENV] ? { command: environment[PI_COMMAND_ENV] } : {}),
    environment,
  });
}
```

- 只导出工厂（和可选 `warmup`），不在模块顶层注册、启动进程或缓存可变的 Session 状态。Node 会缓存模块，模块级可变状态会被多个 Host 连接共享。
- 先复制 `context.environment`（它是冻结快照），再传给 Adapter。
- 可选字段用条件展开，不写 `command: undefined`。
- `warmup` 只有 `claude-code` 和 `antigravity` 实现，内容都是 `try { await adapter.inspect(); } catch {}`。其他插件不要为了形式统一加空实现。
- 工厂可以是 async：`claude-code` 先 `await withUserShellEnvironment(...)` 补齐 GUI 进程缺失的 shell 环境。
- 需要按环境分流时在工厂里分：`claude-code`、`codebuddy`、`cursor-cli`、`workbuddy` 在 `context.platform === "darwin" && context.managedRemoteHost` 时返回 `BrokeredHarnessAdapter`。这是现有特例，新 Harness 不要默认照抄 Broker。
- `deepseek-harness` 只在 `!context.managedRemoteHost && context.openLocalUrl` 时注入 `openWebUi`，受管远程 Host 没有本地 URL opener。
- `context.platform` 类型是 `string`，`qoder` / `qoder-cn` 直接 `as NodeJS.Platform` 强转，这是已有写法，不要扩散到其他地方。

## CODEXHOST_<X>_COMMAND 与可执行文件发现

显式命令覆盖统一叫 `CODEXHOST_<HARNESS>_COMMAND`（`CODEXHOST_CLAUDE_COMMAND`、`CODEXHOST_GROK_COMMAND`、`CODEXHOST_KIMI_COMMAND`、`CODEXHOST_QODERCN_COMMAND` 等）。读取方式有两种：

1. 工厂读取环境变量，作为 `command` 传给 Adapter（主流）。
2. 只在 `HarnessDiscoverySpec.commandEnvironmentVariable` 里声明，由 `resolveHarnessExecutable` 从 environment 读取（`codebuddy`、`cursor-cli`、`workbuddy`、`qoder-cn`）。

多数包两处都写同一个名字。**Pi 与 OMP 例外**：工厂读 `CODEXHOST_PI_COMMAND` / `CODEXHOST_OMP_COMMAND`，discovery spec 读原生的 `PI_COMMAND` / `OMP_COMMAND`。改这两个包时不要把两者“统一”，否则会改变用户已有配置的行为。

`command.ts` 只声明规则，搜索算法由 `@codexhost/harness-discovery` 负责（`packages/harness-discovery/src/resolve.ts`）：

```ts
export const kimiDiscoverySpec: HarnessDiscoverySpec = {
  id: "kimi-code", command: "kimi", commandEnvironmentVariable: KIMI_COMMAND_ENV,
  installRoots: { windows: ["~/.kimi-code/bin", "${APPDATA}/npm"],
                  posix: ["~/.kimi-code/bin", "~/.local/bin", "/usr/local/bin"] },
};
```

- 常见的 `resolveXxxExecutable(input, dependencies)` 调用 `resolveHarnessExecutable`，找不到时抛出本包的 `XxxExecutableError`（带 `code = "XXX_NOT_FOUND"`），再用 `targetPath(platform).isAbsolute` 转成绝对路径（grok、kimi-code、opencode、claude-code、qoder）。Pi 找不到时回退为裸命令 `"pi"`，由 spawn 的 `ENOENT` 映射成 `notInstalled`。
- 已配置命令时，`resolve.ts` 不会回退到 PATH 或安装目录（第 198 行注释）。不要在 Adapter 里自己补回退。
- Windows npm `.cmd` shim 用 `runnableCandidate` 改写成原生入口：claude-code 改成 `claude.exe`，qoder 改成 bundle 里的 `.js`，找不到就拒绝这个候选。
- 拼接调用参数用 `commandInvocation(command, args, env, platform)`，它处理 Windows 的 shim 调用。Node 类 CLI 用 `withNodeRuntimeOnPath` 补 PATH（pi、claude-code）。
- 一个包里只能有一个 `HarnessDiscoverySpec` 常量。Qoder 两版各有一个，由 `variant` 选择，不要让一版回退去找另一版的 CLI。

## src/index.ts

只写 barrel。8 个包（pi、claude-code、deepseek-harness、grok、kiro-cli、omp、opencode、antigravity）额外导出 `packageMetadata = { name, contractVersion: WORKSPACE_CONTRACT_VERSION, adapterContract }`。新包可以沿用，但不是必须的。`qoder-cn` 没有 `index.ts`，`package.json` 也只导出 `./plugin`。`hermes` 的 index 还重新导出了 `createHarnessAdapter`，属于个例。

## 预装清单与构建

- `scripts/release/harness-plugins.json`：`plugins` 列出预装包的目录（必须匹配 `^packages/adapters/[a-z0-9-]+$`），`runtimePackages` 是经过审查、允许打进 Bundle 的第三方包白名单。Host 和 Renderer 都不读这个文件（`scripts/release/harness-plugins.mjs` 注释：“Distribution data only”）。
- `npm run build:plugins` 对每个插件调用 `packages/harness-adapter/scripts/build-plugin.mjs`：用 esbuild 打成单个 `plugin.mjs`（`bundle: true`、`format: "esm"`、`target: "node22"`），复制 Manifest 和图标。以下情况构建会失败：
  - 引入了不在 `runtimePackages` 里的包；
  - 打包输入里出现 `/test/`、`/tests/`、`/tools/` 路径；
  - 出现 source map 引用。
- 构建器只复制 Manifest 和 `icon`。插件运行时如果还需要其他资源文件，必须同时实现打包和文件清单，只在仓库里能跑不算完成。

## 新增 Adapter 的稳定步骤

1. 先确认原生接口和版本。能用原生 SDK、RPC 或服务时优先用；ACP 只在没有更好接口时使用。
2. 在 `packages/adapters/<name>/` 建好 manifest、package.json、tsconfig、`plugin.ts`、`command.ts`、Adapter/Session 实现和 `test/`。
3. 依赖三处同步：`package.json#dependencies`、包内 `tsconfig.json#references`、根 `tsconfig.json#references`。
4. 要预装时，把目录加入 `harness-plugins.json#plugins`，第三方依赖加入 `runtimePackages`。Host 包不增加任何 Adapter 依赖。
5. 新 ID 使用共享路由 `packages/shared-contracts/src/harness-route.ts`，不扩展旧的专用 codec。
6. 插件能被加载不代表 Desktop 已完成接入：Renderer 仍有固定 Agent 名单（见 skill `references/renderer-product-integration.md`）。交付说明要分开写“插件后端 / 预装 / Desktop”三个范围。
