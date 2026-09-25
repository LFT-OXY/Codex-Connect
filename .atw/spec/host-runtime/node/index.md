# host-runtime（Node）

`@codexhost/host-runtime` 是 Host 的组合根，也是 Desktop 与官方 app-server 之间的代理进程。它负责按 Thread 所有权把 Desktop 的 JSON-RPC 请求分给官方 Codex 或外部 Harness，负责外部 Thread 的生命周期、委派、远程 Host 和更新协调，并加载**已安装**的 Harness 插件。Harness 私有协议不写在这里；Codex wire 形状的投影由 `protocol-core` 负责，映射持久化由 `mapping-store` 负责。

## 上下游

- 依赖（`package.json#dependencies` 与 `tsconfig.json#references` 一一对应）：`desktop-control`、`harness-adapter`、`harness-broker`、`mapping-store`、`protocol-core`、`shared-contracts`、`update-manager`，第三方运行时只有 `ws`。
- `src/index.ts` 的 `packageMetadata.dependencies` 同样列出这 7 个包，`test/index.test.ts` 用 `toHaveLength(7)` 锁住这个数量，并断言其中没有 `@codexhost/adapter-*`。新增依赖时，除了通用约定要求的三处，还要同步修改这里。
- 进程入口：`src/main.ts`（源码运行）和 `src/release-main.ts`（发行 Bundle，额外传入 `hostRuntimeUrl: import.meta.url`）。两者用 argv[0] 分派：`--codexhost-delegation-cli`、`--codexhost-harness-broker`、`--codexhost-remote`、`--codexhost-remote-control-bridge`，其余走 `runHostRuntime`。**新增入口模式时两个文件都要改。**
- 下游：Rust Shim/Launcher 把它当作 `codex app-server` 来启动；`scripts/build-release.mjs` 用 esbuild 把 `release-main.ts` 打成发行 Bundle。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [directory-structure.md](./directory-structure.md) | 需要定位某类改动应放在哪个文件时；准备往 `app-server-host.ts` 加代码之前 |
| [plugin-loading.md](./plugin-loading.md) | 涉及插件加载、预装清单、发行 Bundle 审计、Harness 名称分支时 |
| [error-handling.md](./error-handling.md) | 新增或修改 JSON-RPC 错误码、处理 Harness 错误、Approval/Question 失败路径时 |
| [testing.md](./testing.md) | 写或拆分测试，使用 `app-server-host-fixture.ts`，或运行 `*.real.test.ts` 时 |

## 改动前检查清单

1. 先按 [directory-structure.md](./directory-structure.md) 找到所属子域文件。`app-server-host.ts`（约 4500 行）只允许加一行分派和薄调用，新逻辑放进独立模块。
2. `src/` 下禁止 import `@codexhost/adapter-*`（`tools/check-boundaries.mjs` 会拦截），也不要新增 `harnessId === "<具体名>"` 分支。Harness 差异通过 `HarnessAdapter` 能力或插件描述表达。
3. 新的 Desktop 方法：参数用 `shared-contracts` 的 schema `safeParse`，失败返回 `-32602`。外部 Thread 不支持的 `thread/*` 方法必须返回 `-32076`，不能透传给官方（见 [error-handling.md](./error-handling.md)）。
4. 给 `MappingStore` 加公共方法时，同步修改 `src/external-thread-repository.ts` 的 `ExternalThreadStore` 接口。
5. 修改委派 Skill 文本（`src/delegation-skill.ts` 的 `CODEXHOST_DELEGATION_SKILL`）时，把旧版本 digest 追加到 `PREVIOUS_MANAGED_DIGESTS`。否则用户机器上的旧副本会被判定为用户自管文件并报 conflict。
6. 发行 Bundle 相关改动完成后，跑 `tests/release/host-bundle.test.mjs`，确认 `auditHostBundleMetafile` 仍然通过：Bundle 不含 Adapter/SDK，第三方包仍只有 `diff`、`ws`、`zod`。
7. 定向验证：`npx vitest run --config tests/vitest.config.js packages/host-runtime/test/<file>.test.ts`。依赖其他包 `dist` 或 `dist/plugins` 的用例，要先跑 `npm run build:typescript`。

## 场景：委派 CLI 的调用写法

1. **触发**：改动托管 Skill、`delegation-cli-help.ts`、mention 改写指令，或 `next.read/wait` 提示中的命令写法时。
2. **签名**：`delegation-types.ts` 中的 `DELEGATION_CLI_PATH_ENV = "CODEXHOST_CLI_PATH"`、`DELEGATION_CLI_COMMAND = "\"$CODEXHOST_CLI_PATH\""`。所有面向 Agent 的命令都以 `DELEGATION_CLI_COMMAND` 开头，例如 `` `${DELEGATION_CLI_COMMAND} thread read ${threadId}` ``。
3. **契约**：`CODEXHOST_CLI_PATH` 由 Host 注入。`run-host-runtime.ts#delegationCliPath` 先读取已有的 `CODEXHOST_CLI_PATH`，没有时回退到 `CODEXHOST_LAUNCHER_EXECUTABLE`。桌面会话中它通常取 Launcher 自身的原生可执行文件，npm 与安装包两种方式都是这样。npm 入口只有在执行 `delegate/thread/harness` 子命令时，才把它设为 `bin/codex-connect.js`。它被 `officialEnvironment` 放行，会进入原生 Codex 会话。npm 包暴露的命令名是 `codex-connect`，原生二进制仍叫 `codexhost`，所以 PATH 里不保证存在其中任何一个名字。
4. **错误矩阵**：变量缺失时，`"$CODEXHOST_CLI_PATH"` 展开为空，命令失败。已知缺口：远程 SSH Host 的 `managedEnvironment` 和包装脚本都没有注入这个变量，见任务 `09-25-rebrand-codex-connect` 的第 07 票。用户的 `shell_environment_policy` 过滤掉这个变量时，结果相同，所以帮助里的 `include_only` 建议必须包含它。
5. **用例**：
   - 正常：npm 或安装包启动的本地会话，Agent 执行 `"$CODEXHOST_CLI_PATH" delegate --help`。
   - PowerShell：命令写作 `& $env:CODEXHOST_CLI_PATH …`。这个写法已写进 Skill 和 `COMMON_HELP` 首行。
   - 不可用：远程 SSH 会话（未修复前）。
6. **测试**：
   - `delegation-skill.test.ts`：断言版本号，断言 Skill 含 `"$CODEXHOST_CLI_PATH" delegate --help` 和 PowerShell 写法，不含 `codexhost delegate`。
   - `delegation-cli.test.ts`：断言帮助用法行，以及 `include_only` 包含 `CODEXHOST_CLI_PATH`。
   - `delegation-mention-rewrite.test.ts`：断言指令里的命令写法。
   - `harness-delegation-coordinator.test.ts`：断言 `next.read/wait`。
7. **错误与正确写法**：
   - 错误：`` read: `codexhost thread read ${threadId}` ``。这个写法依赖 PATH 中的命令名，npm 命令改名后就会失效。
   - 正确：`` read: `${DELEGATION_CLI_COMMAND} thread read ${threadId}` ``。修改 Skill 文本时，要把 `SKILL_VERSION` 加一，并把旧文本的 digest 追加到 `PREVIOUS_MANAGED_DIGESTS`（见检查清单第 5 条）。
