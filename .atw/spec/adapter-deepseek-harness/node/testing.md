# DSH：测试与覆盖率

## 组织

- 测试目录与源码一一对应：`test/<file>.test.ts` 对应 `src/<file>.ts`，`test/modern/*.test.ts` 对应 `src/modern/*`，`test/profiles/parser-boundaries.test.ts` 覆盖 profile 解析边界。V3、V4 各有一个格式级文件：`test/modern/v015.test.ts`、`v017.test.ts`。
- **没有共享的 fake 模块**。每个测试文件自己定义 `Feed`（可推送的 `AsyncIterable`，用来模拟 Remote 流）和各自的 fake remote。生产代码通过构造函数的依赖参数注入这些替身：
  - 门面：`DeepSeekHarnessAdapterDependencies`（`probeExecutable`、`createModernAdapter`）
  - Modern Adapter：`ModernDeepSeekHarnessAdapterDependencies`（`createConnection`、`randomUUID`、`now`）
  - Remote：`ModernRemoteConnectionDependencies`（`spawn`、`fetch`、`createWebSocket`、`killProcessTree`、`platform`）
  - 版本探测：`DeepSeekGenerationProbeDependencies`

  新的模块也应该只依赖最小的 remote 接口（参照 `ModernJournalRemote`、`ModernCommandRemote`），这样测试不需要启动进程或网络。
- 时间相关的逻辑（关联宽限期、关闭超时、事件网关重连）用 `vi.useFakeTimers()`，见 `test/modern/session.test.ts`、`event-gateway.test.ts`。**不要用依赖机器速度的耗时阈值做断言**（validation 文档“CodeRabbit 复核修复”一节）。
- 这个包的测试不使用 `@codexhost/harness-adapter/testing` 的 `FakeHarnessSession`，因为被测对象就是 Session 本身。

## 覆盖率门槛

```sh
npm run test:deepseek:coverage
```

- 配置文件 `tests/vitest.deepseek-coverage.config.js`：在 `tests/vitest.config.js` 基础上把范围限定为 `packages/adapters/deepseek-harness/test/**/*.test.ts`，覆盖率统计 `packages/adapters/deepseek-harness/src/**/*.ts`（包括未被执行的文件），statements / branches / functions / lines 四项都要达到 **80%**。报告输出到 `coverage/deepseek-harness/`，不提交到 Git。
- 这个脚本会先执行 `npm run build:typescript`。
- 统计范围是整个包，**不能只统计新增代码**，也不能靠删除有效测试来提高百分比（文档：“函数覆盖率超过 90% 保留，不删除有效测试来降低数字”）。截至最近记录（`docs/harnesses/deepseek/dsh-015rc1-validation.md`）为 849 项测试 / 23 个文件，分支覆盖率 82.17%，离门槛最近。新增分支必须同时补测试。

## 修 bug 的方式

先写能复现旧实现错误的测试，再修代码（validation 文档：“补充测试先复现旧实现的错误，再验证修复”）。协议相关的修复要同时覆盖合法和非法两种输入。现有的 V3/V4 回归已经覆盖非法历史、developer 工具引用、Fork 边界、跨格式 checkpoint 等。

## 真实 CLI Gate（`tools/gate-dsh/lifecycle.real.test.mjs`）

- 从 `packages/adapters/deepseek-harness/dist/index.js` 导入 Adapter，所以要先 build。只有设置了 `CODEXHOST_DSH_REAL_COMMAND` 时才运行（`describe.runIf`），否则跳过。
- 使用本地 SSE 模拟模型和临时 `DSH_HOME`，不调用真实计费模型。覆盖流式增量、取消与 HTTP 停止、空历史和保留历史的回滚、冷恢复、继续输入、活动 Session 关闭、请求无重叠。不覆盖原生 V4 Fork 和真实模型的工具调用。
- 每个版本都要用**精确隔离安装**的 `dsh`。`dsh --version` 或 `--help` 成功不能证明 Web 可以启动（rc.2 的依赖漂移案例）。

```sh
CODEXHOST_DSH_REAL_COMMAND=<某个精确版本 dsh 的绝对路径> \
  npx vitest run --config tests/vitest.config.js tools/gate-dsh/lifecycle.real.test.mjs
```

真实 Gate 需要启动原生进程并占用端口，不是例行检查。只在改动了进程、认证、取消/关闭、落盘或 Fork 路径，或者要接入新的 DSH 版本时运行，并在结果中写明版本与平台。
