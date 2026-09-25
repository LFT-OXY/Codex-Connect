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

## 场景：委派命令名随 npm 命令名改名

1. **触发**：npm 暴露的命令名变化，或修改托管 Skill、`delegation-cli-help.ts`、mention 改写指令、`next.read/wait` 提示、未知命令报错里的命令写法时。
2. **签名**：沿用上游设计。面向 Agent 的命令直接写 npm 命令名 `codex-connect`（等于 `scripts/release/prepare-npm.mjs` 的 `NPM_COMMAND_NAME`），例如 `` `codex-connect thread read ${threadId}` ``。本包不能导入发布脚本，所以名字是字面量，散在 6 个源文件中：`delegation-skill.ts`、`delegation-cli-help.ts`、`delegation-cli.ts`、`delegation-mention-rewrite.ts`、`app-server-host.ts`、`harness-delegation-coordinator.ts`。同一命令名还出现在 remote 子命令的 usage 与报错里（`remote-host-cli.ts`、`remote-host-lifecycle.ts`），改名时一并处理。
3. **契约**：Agent 靠 PATH 找到这个命令。npm 安装会把 `codex-connect` 放进 PATH，本机和远程 SSH 都一样。原生二进制仍叫 `codexhost`，但它不在 PATH 里。安装包用户的行为与上游相同。原生 Codex 会话的托管 Skill 和相关提示，不改成按 `CODEXHOST_CLI_PATH` 调用：那样偏离上游设计，而且远程 SSH Host 不注入这个变量，远程会话里的委派会失效。其他 Harness 的 Adapter（CodeBuddy、WorkBuddy、Hermes、Cursor）在上游就是按 `CODEXHOST_CLI_PATH` 调用的，保持不变。
4. **错误矩阵**：Skill 文本变了但版本号和旧摘要没跟上 → 用户机器上的旧副本会被当作用户自管文件，报 `conflict`，保持旧文本不再更新。只改了部分文件的命令名 → Agent 按旧名调用失败。
5. **用例**：
   - 正常：npm 用户在本机或远程会话里执行 `codex-connect delegate --help`。
   - 基线：安装包用户，与上游一致。
   - 反例：保留 `codexhost delegate`。npm 已不再提供这个命令。
6. **测试**：
   - `delegation-skill.test.ts`：断言版本号，断言文本含 `codex-connect delegate --help`、不含 `codexhost delegate`。
   - `delegation-cli.test.ts`：断言各命令的帮助含 `codex-connect <group> <command>`。
   - `delegation-mention-rewrite.test.ts`：断言指令含 `` `codex-connect delegate start --harness <id>` ``。
   - `harness-delegation-coordinator.test.ts`：断言 `next.read/wait`。
7. **错误与正确写法**：
   - 错误：为了修复改名引起的问题，改成另一套调用机制（例如 `"$CODEXHOST_CLI_PATH"`）。
   - 正确：只替换命令名，把 `SKILL_VERSION` 加一，并把被替换文本的 digest 追加到 `PREVIOUS_MANAGED_DIGESTS`。
