# adapter-qoder

> 通用约定见 `.atw/spec/adapters/node/index.md`（包结构、工厂、会话契约、测试）。本文只写 Qoder 特有的内容。

## 职责与边界

`@codexhost/adapter-qoder` 用 Qoder Agent SDK 驱动本机的 Qoder CLI。**同一份实现服务两个插件**：本包的 `qoder`（海外版），以及只含 Manifest 和工厂的 `packages/adapters/qoder-cn`（`qoder-cn`，见 `.atw/spec/adapter-qoder-cn/node/index.md`）。

- 依赖（`package.json`）：`@qoder-ai/qoder-agent-sdk` 和 `@qodercn-ai/qodercn-agent-sdk`，都精确锁定为 `1.0.39`；另依赖 `harness-adapter`、`harness-discovery`、`shared-contracts`。两个 SDK 都在 `scripts/release/harness-plugins.json#runtimePackages` 中。
- 下游：`adapter-qoder-cn` 通过包名导入 `QoderAdapter`。`index.ts` 导出的内容（`QoderAdapter`、`resolveQoderExecutable`、Model/权限编码、`QoderSession`）就是兄弟包和测试可以依赖的公开 API。

## 发行版变体（`variant: "global" | "cn"`）

`src/qoder-runtime.ts#QODER_RUNTIMES` 是唯一的分派点，**按变体选择整个 SDK 模块**，不只选择 `query()`，这样 query、认证、历史读取和 fork 都来自同一个发行版：

| | global (`qoder`) | cn (`qoder-cn`) |
|---|---|---|
| SDK | `@qoder-ai/qoder-agent-sdk` | `@qodercn-ai/qodercn-agent-sdk` |
| CLI 命令 / npm 包 | `qodercli` / `@qoder-ai/qodercli` | `qoderclicn` / `@qodercn-ai/qoderclicn` |
| 命令覆盖 | `CODEXHOST_QODER_COMMAND` | `CODEXHOST_QODERCN_COMMAND` |
| PAT | `QODER_PERSONAL_ACCESS_TOKEN` | `QODERCN_PERSONAL_ACCESS_TOKEN` |
| 用户目录 | `~/.qoder` | `~/.qoder-cn` |

- 认证：环境里有对应 PAT 时用 `sdk.accessTokenFromEnv()`，否则用 `sdk.qodercliAuth()`（`qoderAuthForEnvironment`）。一个变体不能使用另一个变体的 token（测试 “does not use the other distribution's token”）。
- 每次调用 SDK 都会注入 `QODER_SDK_CUSTOM_BASE_URL_BYOK=1`（环境里已有值时不覆盖，见 `qoderEnvironment`）。
- 发现（`qoder-command.ts`）只找 CLI 运行时，**不找编辑器启动器 `qoder` / `qodercn`**，因为它们与 SDK 不兼容（issue #329，测试 “rejects editor-only installations without starting an SDK query”）。Windows 上的 `.cmd` shim 会被改写成 `node_modules/<npm包>/bundle/<cmd>.js`。
- Native Ref、Turn Ref、Checkpoint 都使用各自变体的 Harness ID。跨变体的 resume、fork、rollback 在调用 SDK 之前就被拒绝。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [sdk-session.md](./sdk-session.md) | 改 `QoderSession`、Turn/取消/交互、历史、Fork/Rollback、配置切换、错误映射时 |
| `src/qoder-adapter.ts` | inspect（按 cwd 缓存）、open 四个分支、executionPolicy 映射 |
| `src/qoder-sdk-transport.ts`（约 1850 行） | `QoderSession`，同时包含 SDK 消息投影；**不要再往里加新职责** |
| `src/qoder-runtime.ts`、`qoder-command.ts` | 变体分派、发现、环境 |
| `src/qoder-models.ts`、`qoder-permission-modes.ts` | Model Ref（`qoder-model-v1.`）、Thinking、权限目录 |
| `src/qoder-history.ts`、`qoder-usage.ts`、`qoder-slash-commands.ts`、`qoder-errors.ts` | 历史投影、Usage、命令目录、错误码映射 |
| `src/qoder-sdk-types.ts` | SDK 类型的本地别名，不写逻辑 |
| `docs/architecture/harness-plugin-runtime.md`（“Qoder 以两个独立预装插件展示”段落） | 产品层面的约束 |

## 改动前检查清单

1. 新增任何 SDK 调用时，都经由 `QODER_RUNTIMES[variant].sdk` 或注入的函数，不要直接 `import { query } from "@qoder-ai/..."`，否则 cn 版会用错 SDK。
2. 两个 SDK 的版本要同步升级；升级后跑 `qoder-variants.test.ts`。
3. 新增构造选项时，确认 `qoder-cn/src/plugin.ts` 也能拿到（它只传 `variant`、`environment`、`platform`）。
4. 修改状态上报时，注意当前实现把请求值当作生效值上报（见 sdk-session.md 的“已知偏差”），不要把这种写法扩散到新代码。
5. 定向验证：
   ```sh
   npx vitest run --config tests/vitest.config.js packages/adapters/qoder/test
   ```
