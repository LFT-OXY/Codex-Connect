# adapter-deepseek-harness（Node）

> 通用约定见 `.atw/spec/adapters/node/index.md`（plugin.ts 工厂、manifest、HarnessResult、command.ts、测试组织等）。本目录只写 DeepSeek Harness（DSH）特有内容。

`@codexhost/adapter-deepseek-harness` 自己启动并托管一个本地 `dsh web` 进程，通过它经过认证的 Web Remote（HTTP unary + WebSocket mux 流）接入 DeepSeek Harness。Native Session、日志文件、凭据与迁移都归 DSH 所有；本包只通过 Remote 接口读写，**不读取、不改写 DSH 的原生日志文件**。

- 依赖（`package.json`）：`@codexhost/harness-adapter`、`@codexhost/shared-contracts`、`ws`（Remote 流）、`@deepseek-ai/schemastery`（解析 `settings/describe` 返回的 Schema，见 `modern/permission-modes.ts`）、`diff`（`projection.ts` 生成文件差异）。本包不依赖 `harness-discovery`，可执行文件解析由 `src/executable.ts` 自己实现。
- 包导出：`.`（`DeepSeekHarnessAdapter`、`packageMetadata`）和 `./plugin`。`tools/gate-dsh` 直接导入 `dist/index.js`。
- 环境变量：`CODEXHOST_DEEPSEEK_HARNESS_COMMAND`（可执行文件）、`CODEXHOST_DEEPSEEK_HARNESS_ENDPOINT`（用于探测外部 Web 实例的回环端点，默认 `http://127.0.0.1:3080/`），定义在 `src/plugin.ts`。
- 插件只在非受管远程 Host 上传入 `openWebUi`（`context.openLocalUrl`），远程 Host 不提供“打开 DSH Web”。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [architecture.md](architecture.md) | 需要理解外层门面、代际选择、版本 profile（V0/V3/V4）以及 `modern/` 模块分工时；想找“legacy 路径”时先读这里 |
| [remote-and-session.md](remote-and-session.md) | 改托管 Web 进程、认证、Remote 调用/流、控制投影、审批/问题网关、Prompt 关联、取消/关闭、Model/权限配置、命令时 |
| [history-and-fork.md](history-and-fork.md) | 改日志读取与校验、历史投影、Checkpoint、Fork、rollbackLastTurn、Fork 继承队列清理时 |
| [testing.md](testing.md) | 写测试、跑覆盖率门槛、跑真实 CLI Gate 时 |
| `docs/harnesses/deepseek/dsh-edit-recovery.md`、`dsh-015rc1-validation.md` | 需要各 DSH 版本的实测证据、已验证版本列表或 Gate 命令时 |

## 技术债（不要继续往里堆）

`modern/session.ts`（约 3000 行）、`modern/history.ts`（约 1900 行）、`modern/deepseek-harness-adapter.ts`（约 1400 行）、`modern/remote-connection.ts`（约 1350 行）、`modern/event-gateway.ts`（约 1300 行）、`modern/control-store.ts`（约 1200 行）都已经超过 800 行。新增能力应该按协议端点或关注点新建模块，参考 `modern/fork-inbox.ts`、`modern/commands.ts`、`modern/session-list.ts`：一个端点对应一个严格解析函数，加一个接收最小 remote 接口的加载函数。

## 改动前检查清单

1. 新的 Remote 端点只能通过 `ModernRemoteConnection.call` / `openStream` 调用（端点名会经 `assertModernUnaryEndpoint` 校验），返回值要用 `hasExactKeys` / `hasExactOptionalKeys` 这类精确形状校验，不能宽松接受。
2. 与 DSH 版本相关的差异放进 `profiles/` 下的 `DeepSeekModernProfile` 字段，不要在 `modern/*` 里写 `version === "…"` 分支。
3. 修改 checkpoint、locator 或 Fork 边界时，确认 V0 / V3 / V4 三种格式的前缀互不混用（见 [history-and-fork.md](history-and-fork.md)）。
4. 配置变更（Model、Thinking、权限）必须等到 `session/control` 投影出**更高 seq 的精确值**才算成功，不能只凭 unary 回执判断。
5. 不确定结果的 Prompt 不能重发。Modern 协议没有 requestId 幂等保证（`session.ts` 注释）。
6. 所有错误消息和诊断先经过 `redactModernCredential` / `sanitizeModernRemoteFailure`，stderr 尾部还要再经过 `sanitizeDiagnosticTail`。
7. 改完后运行 `npm run test:deepseek:coverage`，四项 80% 门槛覆盖整个 `src/**/*.ts`，新代码没有测试就会拉低整包覆盖率。

## 定向验证

```sh
npx vitest run --config tests/vitest.config.js packages/adapters/deepseek-harness/test/modern/<file>.test.ts
npm run test:deepseek:coverage          # 先 build:typescript，再按 80% 门槛跑整包
```

真实 CLI Gate 见 [testing.md](testing.md)。
