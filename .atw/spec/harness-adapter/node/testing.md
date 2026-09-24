# 测试与 Fake 实现

## `@codexhost/harness-adapter/testing`

`src/testing.ts` 是生产代码目录下的**测试支撑导出**，下游测试共用它，不要在各自测试里再写一个 `HarnessAdapter` 假实现。目前使用它的测试文件：host-runtime 15 个、harness-broker 2 个、adapters/workbuddy 1 个。

- `FakeHarnessAdapter(harnessId?, catalog?, supportsFork?, supportsForkAcrossCwd?, initialUsage?, permissionModes?, supportsRollbackLastTurn?, permissionModeScope?)`：用位置参数配置能力，`inspect()` 返回的能力位由这些参数推导，`sessions` 数组记录每次 `open` 创建的 Session，`inspectionCalls` 统计调用次数。
- `FakeHarnessSession` 通过命令式方法驱动生命周期：`appendText`、`startReasoning`、`startCommandExecution` / `appendCommandOutput`、`startToolExecution` / `replaceToolOutput`、`emitFileChange`、`startSubagentDelegation`、`requestApprovalOnNextTurn`、`succeedTurn` / `failTurn` / `completeCancellation` / `fault`。注入失败用 `rejectNextTurn`、`rejectNextModelSelection` 等 `rejectNext*` 方法。
- 默认 catalog 是合成数据（`fake-model-v1.primary` / `.secondary`，thinking 取 `off|low|high`），先经 `harnessModelCatalogSchema.parse` 校验再使用。

**Fake 本身就是契约的参考实现。** `test/text-session.test.ts`（约 1000 行）几乎全部用 Fake 断言事件顺序和拒绝语义。所以：

- 改 `session-contract.md` 中的任一不变量时，先改 Fake 和 `text-session.test.ts`，再去改各 Adapter。
- 给 Fake 加驱动方法时，也要遵守同样的终止顺序（Item → Turn → fault）和 Interaction 关闭规则，否则下游 host-runtime 测试会在错误的前提下通过。
- 不要为了让某个下游测试方便而让 Fake 做真实 Harness 不会做的事，例如在 `supportsFork=false` 时仍返回 checkpoint（见 "reports unsupported Fork without emitting Checkpoints"）。

## 本包测试

| 文件 | 覆盖 |
|---|---|
| `test/text-session.test.ts` | Turn/Item/Interaction 生命周期、配置命令、Fork/Rollback、Permission Mode、幂等关闭 |
| `test/approval.test.ts` | Approval 声明的 action、作用域、错误类型/重复/跨 Session 响应 |
| `test/usage.test.ts` | `parseHostUsage` 的字段白名单与数值约束 |
| `test/diagnostics.test.ts` | 脱敏、尾部截断、过滤 Node 的 `(node:1234) [UNDICI-EHPA]` 警告 |
| `test/live-command-catalog.test.ts` | live 命令合并、`COMMON_EXCLUDED_LIVE_COMMANDS` 只过滤命令不过滤同名 skill |

本包测试用 `../src/*.js` 相对导入，不依赖 `dist`。下游包通过包名导入 `/testing`，所以改完 Fake 后要先 `npm run build:typescript`，再跑下游测试。

```bash
npx vitest run --config tests/vitest.config.js packages/harness-adapter/test/text-session.test.ts
npx vitest run --config tests/vitest.config.js packages/host-runtime/test packages/harness-broker/test
```
