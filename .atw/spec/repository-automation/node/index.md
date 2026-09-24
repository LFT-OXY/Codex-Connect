# repository-automation（node）

`@codexhost/repository-automation` 是仓库治理用的源码 ESM 包（`.mjs`，没有 TypeScript、构建步骤或第三方运行时依赖），做两件事：

1. **PR 维护**：`runMaintenance` / `maintainItem`。只根据明确的 `fix:` / `feat:` / `docs:` 标题打 `bug` / `enhancement` / `documentation` 标签，并在当前 HEAD 的 CI 结束后更新**一条**简短结果评论。
2. **发布校验**：`readReleaseMetadata` / `resolveRelease` / `verifyRelease` / `assertReleaseCi` / `waitForReleaseCi` / `validateReleaseVersion`。保证 tag、`package.json`、`package-lock.json`、Cargo workspace 版本与 main 上精确提交的 CI 证据一致。

它不属于 Host 产品，不参与打包。行为说明见 `docs/operations/repository-maintenance.md` 和 `CONTRIBUTING.md`（"PR 标题明确为 `fix:` / `feat:` / `docs:` 时添加…不明确就跳过"）。

## 依赖与使用方

- `package.json` 没有 `dependencies`，`exports` 为 `".": "./index.mjs"`。`src/*.mjs` 只导入 `node:child_process`、`node:util` 和包内模块（`policy.mjs` 注释："Repository governance only: no Host, Harness, or model runtime dependencies."）。
- 调用方通过**文件路径**导入 `index.mjs`，而不是包名：
  - `.github/workflows/repository-maintenance.yml`、`release-packages.yml`：`sparse-checkout: packages/repository-automation` 之后 `import(pathToFileURL(resolve('packages/repository-automation/index.mjs')))`。
  - `scripts/release/prepare-version.mjs`：`import { validateReleaseVersion } from "../../packages/repository-automation/index.mjs"`。
- 因此**不能**引入 npm 依赖，也不能导入仓库里本包目录以外的任何文件。工作流只 sparse-checkout 这一个目录，并且明确不执行 `npm ci`（`workflows.test.mjs` 断言工作流中不含 `npm (?:ci|install)`）。`index.mjs` 头注释："Trusted GitHub workflows import this file directly so they never need npm install, lifecycle scripts or a build."
- GitHub API 客户端（`github.rest.*`、`github.paginate`）和 `core` 都由 `actions/github-script` 注入，本包不自己创建客户端。

## 结构

| 文件 | 职责 |
|---|---|
| `index.mjs` | 唯一公开入口，只做重新导出 |
| `src/policy.mjs` | 常量（`CI_WORKFLOW`、`CI_JOBS` 四项、`TYPE_LABELS`、`COMMENT_MARKER`、`BOT_LOGIN`），以及 Markdown 转义函数 `markdown()` 和只接受 `https://github.com` 的 `githubLink()` |
| `src/intake.mjs` | `conventionalType` / `planLabels`：只看标题，只同步有事件证明由本机器人添加的标签 |
| `src/github.mjs` | `readCi`、`resolveTargets`：按实时 PR HEAD 找可信 CI 运行 |
| `src/report.mjs` | 结果判定与评论渲染 |
| `src/ci-logs.mjs` | 下载失败日志、提取诊断、脱敏（`redactLogLine`），上限 8 MiB |
| `src/maintenance.mjs` | 编排：读取 → 计划 → 写入前重新核对快照 → 写入 |
| `src/release.mjs` | 发布版本与 CI 证据校验，通过 `execFile("git", …)` 读取 tag 数据 |

## 必须保持的约定

- **Fail closed，不猜测**：CI 读取失败不发布结果（测试 "propagates API failures rather than fabricating green status"）。只有工作流和四个 job 都有唯一的成功证据，才算全部通过；queued、skipped、重复 job 都不算通过。标题不明确就跳过，不从正文、提交或文件路径推断类型（测试 "ignores body, commits and old Issue template evidence"）。
- **写入前重新核对**：`maintainItem` 在写入前要再读一次 PR，并比对 `sameSnapshot`（head、base、title、body、updated_at），同时比对 `ciFingerprint`；发生变化就放弃这次过期快照。自己的标签写入会改变 `updated_at`，只有这种情况允许豁免。
- **只接管自己的评论**：`isMaintenanceComment` 同时要求 `github-actions[bot]`、`type: "Bot"` 和 `COMMENT_MARKER` 前缀，人工伪造的标记不会被接管。人工或其他工具改过的类型标签不再自动同步。
- **不可信输入**：CI 日志和 PR 文本都当作数据处理。输出前必须经过 `markdown()` 转义（包括把 `@` 替换成全角，防止 mention）、`githubLink()` 白名单和 `redactLogLine()` 脱敏。永远不执行日志内容，也不转发日志的签名下载 URL。
- **默认实际写入**：`maintainItem` / `runMaintenance` 的 `dryRun` 默认是 `false`，预览要显式传 `dryRun: true`；GitHub 手动触发时 `dry_run` 默认是 `true`。
- 状态文案用中文（"跳过（已关闭、锁定或停用）"、"PR 已变化，跳过过期快照"），`core.summary` 标题用英文，沿用现状即可。
- `CI_JOBS` 必须与 `.github/workflows/ci.yml` 的 matrix 名称一致，由 `workflows.test.mjs` 的 "keeps CI job names synchronized with the actual matrix" 守护。改 CI job 名要同时改 `policy.mjs`。

## 改动前检查清单

1. 先读 `docs/operations/repository-maintenance.md`。它是行为规格，改变行为时要同步更新它、`README.md` 和 `CONTRIBUTING.md` 的相关段落。
2. 不新增 import 目标：只允许 `node:*` 和 `./src/*.mjs`。需要第三方能力时，先确认工作流的 sparse-checkout 和无安装约束仍然成立。
3. 所有 GitHub 列表读取都走 `list()`（`paginate` + `per_page: 100`），不要只读第一页。
4. 新增输出到评论的字段必须先经过 `markdown()` / `githubLink()`；新增日志摘录必须经过 `redactLogLine()` 并受行数和长度上限约束（最多 4 个 job × 5 行 × 500 字符）。
5. 测试用 `test/fixtures.mjs` 构造 PR/CI 数据，用 `vi.fn` 模拟 `github` 对象，不访问网络。`release.test.mjs` 会在临时目录创建真实 git 仓库。
6. 定向运行：`npx vitest run --config tests/vitest.config.js packages/repository-automation/test/`（包内 `npm test` 等价）。CI 只在 Linux x64 上运行这些测试，Lint 由根 `eslint.config.js` 的 `.mjs` 规则覆盖（`npm run lint`）。
