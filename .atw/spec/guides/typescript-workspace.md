# TypeScript Workspace 通用约定

> 适用于 `packages/*` 与 `packages/adapters/*` 下全部 TypeScript 包。各包 spec 只写本包特有的内容，与本文冲突时以包 spec 为准。

## 权威来源

- 所有权、边界与完成标准：根目录 `AGENTS.md` / `CLAUDE.md`
- 依赖方向的可执行检查：`tools/check-boundaries.mjs`（`npm run lint` 会运行）
- 术语：`docs/project/领域术语表.md`，不要混用 Harness、Model、Provider、Account、Billing Source
- 编译选项：`tsconfig.base.json`；Lint：`eslint.config.js`；格式：根 `package.json` 的 `prettier` 字段

## 包结构

每个包都采用同一套结构：

```
packages/<pkg>/
  package.json     # "type": "module"，通过 exports 暴露 dist/*.js 与 *.d.ts
  tsconfig.json    # extends tsconfig.base.json，composite，rootDir=src，outDir=dist，references 列出依赖包
  src/             # 生产代码，kebab-case 文件名，一个文件负责一个主题
  test/            # vitest 用例，*.test.ts
  scripts/         # 可选，包内构建脚本（.mjs）
```

- `src/index.ts` 是公开 barrel，只放 `export { … } from "./x.js"` 和 `export type { … }`，不写逻辑（参见 `packages/harness-adapter/src/index.ts`）。
- 需要额外入口时加到 `package.json#exports` 子路径，例如 `@codexhost/harness-adapter/plugin`、`/testing`，`@codexhost/shared-contracts/version`。
- 新增包依赖时要同时改三处：`package.json#dependencies`、`tsconfig.json#references`，以及 `tools/check-boundaries.mjs` 允许的方向。

## 编译与导入

- `tsconfig.base.json` 打开了 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`、`module: NodeNext`。
- 相对导入必须带 `.js` 后缀：`import { PiAdapter } from "./pi-adapter.js";`
- 纯类型导入要写成 `import type` 或内联 `type`，ESLint 规则 `consistent-type-imports` 会拦截违规写法。
- 可选字段不能显式赋 `undefined`（`exactOptionalPropertyTypes`）。可选字段用条件展开写入，例如 `packages/adapters/pi/src/plugin.ts`：
  ```ts
  ...(environment[PI_COMMAND_ENV] ? { command: environment[PI_COMMAND_ENV] } : {}),
  ```
- 跨包只能通过包名导入，例如 `@codexhost/<pkg>` 或其 exports 子路径。以下写法会被 `check-boundaries` 报错：
  - `@codexhost/x/src/...`
  - 用相对路径引用其他包的源码
  - `host-runtime/src` 导入 `@codexhost/adapter-*`
- 导入顺序：先 `node:` 内置模块，再第三方和 `@codexhost/*`，最后本包相对路径，各组之间空一行。

## 运行时校验与数据契约

- 跨进程、跨包或跨浏览器边界的数据，用 zod 定义 schema，再用 `z.infer` 推导类型。这类 schema 集中放在 `packages/shared-contracts/src/*`，例如 `harness-plugins.ts`、`errors.ts`。
- 对象 schema 默认用 `.strict()` / `z.strictObject`。出现可选字段时，配合 `rejectExplicitUndefined`（`shared-contracts/src/json-value.ts`）拒绝显式的 `undefined`。
- schema 上的注释只写不变量和信任边界，例如 `harness-plugins.ts` 里的 "A manifest is data only. It must be validated before importing any plugin code."。

## 错误处理

项目里有三种错误形态，按所在位置选用，不要混用：

| 位置 | 形态 | 示例 |
|---|---|---|
| Harness 会话契约（Adapter ↔ Host） | `HarnessResult<T> = { ok: true; value } \| { ok: false; error: HarnessError }`，不向 Host 抛异常 | `packages/harness-adapter/src/text-session.ts` |
| 需要跨边界序列化的错误 | `CodexhostError`（`code`、`message`、`retryable`，以及可选的 `diagnostic`、`stage`、`stderrTail`） | `packages/shared-contracts/src/errors.ts` |
| 包内控制流 | 具名的 `class XxxError extends Error`，在包边界处转换成上面两种形态 | `host-runtime/src/external-command-routing.ts`、`adapters/pi/src/pi-rpc-session.ts` |

- Adapter 用本地的 `normalizedError(error, fallbackCode)` / `toHarnessError` 这类函数把未知异常映射成 `HarnessError`，参见 `adapters/pi/src/pi-adapter.ts`、`adapters/omp/src/omp-adapter.ts`。
- 子进程的 stderr 或诊断文本要先经过 `sanitizeDiagnosticTail`（会脱敏 token/password/Bearer 并截断长度）和 `filterAmbientNodeWarnings`，才能放进错误或暴露给 UI。两个函数都来自 `@codexhost/harness-adapter`。
- 不要吞掉错误后返回看似成功的结果；Harness 不支持的能力要返回明确的错误码，不要伪造等价行为（见 `AGENTS.md` Product Intent）。

## 日志

- TS 包没有统一的 logger。生产代码几乎不用 `console.*`，只有 renderer / desktop-control 的少量调试点。Node 侧的诊断写到 `process.stderr.write`。
- 诊断信息应尽量通过结构化字段（`diagnostic`、`stderrTail`、`stage`）传递，而不是另写日志。

## 测试

- 位置：`packages/<pkg>/test/*.test.ts`，由 `tests/vitest.config.js` 统一收集。
- 本包源码用 `../src/x.js` 导入；其他包用包名导入，前提是已经执行过 `npm run build:typescript`，因为包名解析到 `dist`。
- 需要真实 Harness 或真实环境的用例命名为 `*.real.test.ts`，并用环境变量控制开关，默认跳过，例如 `CODEXHOST_RUN_CLAUDE_HOST_REAL === "1"`（见 `host-runtime/test/app-server-host.claude.real.test.ts`）。
- 模拟 Harness 时优先用 `@codexhost/harness-adapter/testing` 里的 `FakeHarnessAdapter` / `FakeHarnessSession`，不要每个测试各写一份假实现。
- 用到文件系统、进程、平台分支（`node:fs`、`process.platform`、`mkdtemp` 等）的测试会被自动归入 Windows 的 platform lane。路径处理需要同时兼容 `\` 和 `/`。
- 定向运行：`npx vitest run --config tests/vitest.config.js packages/<pkg>/test/<file>.test.ts`。不要默认跑全量测试。

## 验证命令

从根 `package.json` 选择与改动相称的命令：

- `npm run typecheck`：类型检查，包括 `tests/tsconfig.json`
- `npm run lint`：ESLint 加边界检查
- `npm run format:check`：Prettier，宽度 100，双引号，尾逗号 `all`
- 定向跑 vitest（见上一节）

## 模块规模

- 500 行是需要审视设计的信号；接近或超过 800 行的文件，新功能应放进独立模块。
- 已知的超大文件 `packages/host-runtime/src/app-server-host.ts`（约 4500 行）属于历史状态，不要继续往里堆新职责。
