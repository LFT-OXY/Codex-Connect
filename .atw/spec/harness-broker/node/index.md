# harness-broker（node）

`@codexhost/harness-broker` 通过**owner-only 的 Unix socket 与换行分隔的 JSON 帧**，把一个 `HarnessAdapter` 放到 macOS 当前用户的 Aqua 会话（LaunchAgent）里运行，再把它原样代理给远端 Host。适用场景：SSH 审计会话读不到登录钥匙串里的原生 CLI 凭据（`docs/platforms/macos/native-aqua-broker.md`）。服务端是 `startHarnessBrokerServer`，客户端是 `BrokeredHarnessAdapter`（它自身实现 `HarnessAdapter`）。

## 依赖与使用方

- 依赖：`@codexhost/harness-adapter`、`@codexhost/shared-contracts`、`zod`（`package.json`、`tsconfig.json#references`，`types: ["node"]`）。
- 服务端入口：`host-runtime/src/aqua-harness-broker.ts` 的 `runClaudeAquaHarnessBroker`，它只加载一个插件（`onlyIds`、`warmup: false`）。LaunchAgent 的生命周期由 Rust 负责（`codexhost broker install|status|stop|uninstall --harness <id>`）。
- 客户端：在 `context.platform === "darwin" && context.managedRemoteHost` 时，由 `adapters/{claude-code,codebuddy,workbuddy,cursor-cli}/src/plugin.ts` 构造。Broker 进程加载同一个插件时使用本地上下文，避免递归创建 Broker 客户端。

## 仍然保留的 Claude Code 专属语义（照实，不要扩散）

名义上是通用 Broker，但默认值和旧路径仍然绑定 Claude Code：

- `paths.ts`：`HARNESS_BROKER_DESCRIPTOR_ENV = "CODEXHOST_CLAUDE_BROKER_DESCRIPTOR"`、`claude-code-broker-v1.{json,sock}`。`harnessId` 缺省为 `"claude-code"`，只有 Claude Code 读取这个环境变量覆盖，其他插件用 `<id>-broker-v1.{json,sock}`。
- `BrokeredHarnessAdapter` 构造时 `harnessId` 缺省为 `"claude-code"`；`forwardDelegationEnvironment` 默认关闭，以保持旧 Claude 客户端的行为，cursor-cli 显式开启。
- 错误文案统一叫 "Aqua Harness broker"；host-runtime 的入口函数名是 `runClaudeAquaHarnessBroker`。

新增 Harness 时必须显式传 `harnessId`，不要依赖缺省值；也不要再添加 `<harness>` 专属常量。改这些默认值会破坏已安装的 LaunchAgent 标签、路径和线协议兼容（文档："preserve the legacy label, paths and wire protocol"）。

## 协议要点（`protocol.ts` / `framing.ts` / `validation.ts`）

- 每帧都带 `version: 1`、`generation`（uuid）和单调 `sequence`；第一帧必须是带 64 位十六进制 `token` 的 `hello`。客户端发现 generation 不符或 sequence 跳号时直接 fail-closed，把整条连接判为失败。
- 上限：单帧 8 MiB（`HARNESS_BROKER_MAX_FRAME_BYTES`），并发请求不超过 32 个，请求超时 15 秒。
- 方法白名单是 `harnessBrokerMethodSchema`（`adapter.*`、`session.*`，共 11 个）。转发新的 Adapter 能力必须先把方法加进去，再在 `server.ts` 的 `handleRequest` 和 `client.ts` 两端各实现一遍。
- `validation.ts` 对 `HarnessOutput` 按事件或 Interaction 类型做**键白名单**（`eventKeys`、`interactionKeys`），对 `HarnessErrorCode` 做 zod 枚举。它和 `harness-adapter/src/text-session.ts` 是两份手工同步的副本：契约新增字段、事件或错误码时，这里不改就会被拒绝。
- 远端能传入的环境变量只有 `brokerEnvironmentSchema` 列出的四个 `CODEXHOST_*`，不得接受 HOME、PATH、loader 变量或凭据。

## 必须保持的安全与所有权不变量

- descriptor 和 socket 放在同一个私有目录，要求 owner-only（mode `& 0o077 === 0`）、uid 与当前用户一致、不能是符号链接，`ownerPid` 必须仍然存活。macOS 上 socket 路径不超过 103 字节。
- 每个 Native Session 同一时刻只能有一个写入者（`nativeWriters`）。`open` 在 await 原生调用**之前**就要预留写入者；`create` 在 bootstrap Turn 确认原生身份之前持有 provisional 租约，期间只允许该 Turn 的 cancel 和 interaction 通过。
- 打开后原生身份（harnessId、nativeSessionId、formatVersion）一旦变化或属于其他 Harness，就发出 `session.faulted`（`protocolError`/`sessionBusy`，`stage: "harnessBroker.*"`）并关闭 Session。
- 恢复只针对已经确认原生身份的 Session：同一条连接上走 `session.reopen`，重连后走 `adapter.open{kind:"resume"}`，并带上最后观察到的 model/thinking/permission 与受限环境。**绝不**创建替代 Session，也不重放被中断的 Turn（测试 "does not invent a replacement native Session when create had not confirmed identity"）。
- 客户端只在调用方发起请求时重新读取 descriptor，没有后台重连或轮询循环（`#connect()` 注释）。`authenticationRequired` 终态会把 Session 标记为 faulted，下一次 `turn.start` 时重开一次。

## 已知技术债

`server.ts`（919 行）和 `client.ts`（752 行）已超过或接近 800 行。`handleRequest` 是一长串 `if (request.method === ...)`。新增方法时优先把处理逻辑抽成独立函数或模块，不要继续加长这个分支链。

## 改动前检查清单

1. 先读 `docs/platforms/macos/native-aqua-broker.md`；它和 `test/harness-broker.test.ts`、`test/broker-recovery.test.ts` 的用例名一起构成行为规范。
2. 改线协议时，`HARNESS_BROKER_PROTOCOL_VERSION`、descriptor 的 `schemaVersion` 和 `packageMetadata.protocolVersion` 要一起考虑；升级协议就意味着旧 LaunchAgent 不兼容。
3. 转发新能力：`protocol.ts` 方法枚举 → `validation.ts` 参数 schema → `server.ts` 分派 → `client.ts` 客户端方法，缺一处就无法转发。
4. 所有来自对端的数据都要先 parse：服务端用 `validation.ts` 的 schema，客户端用 `harnessInspectionSchema`、`harnessSessionCapabilitiesSchema`、`parseHostUsage`、`harnessAccountSnapshotSchema`。
5. 错误返回为 `HarnessResult`，失败时 `code` 用 `unavailable`/`protocolError`/`sessionBusy`，并带 `stage: "harnessBroker..."`，不要向 Host 抛异常。
6. 测试使用 `mkdtemp` + 真实 socket；Windows 分支改用命名管道路径，部分用例用 `it.skipIf(process.platform === "win32")` 跳过。定向运行：`npx vitest run --config tests/vitest.config.js packages/harness-broker/test/`。改了 broker 客户端之后，再跑 `packages/adapters/workbuddy/test/plugin-delegation.test.ts` 和 `packages/host-runtime/test/installed-harness-plugins.test.ts`。
