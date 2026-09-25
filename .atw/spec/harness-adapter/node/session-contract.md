# Session 契约与演进规则

通用错误形态（`HarnessResult<T>`，不向 Host 抛异常）见 `guides/typescript-workspace.md`。这里只写 `text-session.ts` / `plugin.ts` 自身的不变量，以及修改时的影响面。

## 形状

- `HarnessAdapter`：`inspect()`、`open(OpenSessionInput)`、`close()` 是必需成员，其余全是可选能力：`commandCatalog`、`liveCommandCatalog`、`nativeUsage`、`sessionImport`、`subagents`、`webUi`、`inspectAccount`、`credentialExport`、`credentialImports`。
- `OpenSessionInput` 按 `kind` 区分为 `create` / `resume` / `fork` / `rollbackLastTurn`。`resume` 与 `rollbackLastTurn` 可以带上次保存的 `model`、`thinkingOptionId`、`permissionModeId`，供懒初始化配置的 Harness 使用。
- `HarnessSession.execute` 是一组重载，每种 `HostCommand` 对应自己的返回类型（`turn.start` → `TurnStartAccepted`，`model.select` → `ModelSelectCompleted`）。新增命令时要同时加重载、`HostCommand` 联合成员和返回类型，**不要**改成一个返回 `unknown` 的宽签名。
- 输出只有一条流：`outputs: AsyncIterable<HarnessOutput>`，元素是 `{ kind: "event" }` 或 `{ kind: "interaction" }`。Adapter 用 `HarnessOutputChannel` 实现它；这个通道只允许一个消费者，第二次调用 `[Symbol.asyncIterator]()` 会抛 `"Harness outputs allow only one consumer"`。
- `plugin.ts` 的 `HarnessPluginModule` 导出工厂 `createHarnessAdapter(context)` 和可选的 `warmup(adapter)`。注释写明："A loaded module supplies a factory, not a global registration side effect."；`warmup` 是 best-effort 预取，Host 不等待它完成。

## 生命周期不变量（由 `test/text-session.test.ts` 通过 Fake 固化）

- 一个 Session 同一时刻只有一个活动 Turn，并发的 `turn.start` 返回 `sessionBusy`，不改变当前 Turn（"rejects a concurrent Turn without changing the active lifecycle"）。
- 终止顺序固定：先 `item.completed`，再 `turn.completed`，最后 `session.faulted`（"finishes the Item and Turn before a Session fault"）。
- 取消、故障、Session 关闭之前，要先对挂起的 Interaction 发出**恰好一次** `interaction.closed`（`approval.test.ts`："closes pending Approvals once before cancel, fault, and Session-close terminals"）。
- `turn.start` 在被接受前就被拒绝时，不得发出任何生命周期输出（"does not emit lifecycle outputs when a Turn is rejected before acceptance"）。
- 配置命令（`model.select`、`thinking.select`、`permissionMode.select`）要先发出携带新有效值的 `session.state.changed`，再 resolve 命令结果；Turn 进行中拒绝这类写入。
- Interaction 响应先用 `validateHostInteractionResponse(pending, response)` 校验：没有挂起的 Interaction 返回 `invalidState`，类型不符或 action/question ID 未声明返回 `invalidRequest`。

## 字段语义注释是契约的一部分

`text-session.ts` 里的 JSDoc 规定了 Adapter 不能伪造的内容，改动时保留并遵守：

- `HostAgentMessageItem.phase`："Omit when the Harness cannot distinguish progress from its final answer."
- `HostSubagentState.reasoningEffort`："do not infer from parent settings."
- `HostFileChange.diffScope: "fragment"`：局部片段没有文件坐标，不能当整文件 patch 组合。
- `HarnessAdapter.commandCatalog`："Reading it must not inspect, connect to, or open a Native Session."
- `inspectAccount`：返回当前原生认证的实时额度；拿不到时返回 `null`，不能返回会话花费、旧认证缓存，也不能为此发起模型 Turn。
- `HarnessSessionImportSource` / `HarnessCredentialTransfer`：只在后端使用，不得序列化进 Desktop 响应或日志。
- `HarnessNativeUsageRecord`：不含消息正文，也不带 Harness 字段（Host 按 Adapter 归属）；游标对 Host 不透明，Adapter 不保存读取状态；允许重复返回，但只能交出终值。完整契约见 `.atw/spec/host-runtime/node/local-usage.md`。Broker 目前不转发此能力。

这些正是 `AGENTS.md` 所说的"保留 Harness 真实能力与语义"，Harness 做不到的就不声明，不要伪造等价行为。

## 修改契约时的影响面

| 改动 | 必须同步的位置 |
|---|---|
| 新增可选 Adapter/Session 能力 | host-runtime 的调用方（检查 `?.` 缺省路径）；`BrokeredHarnessAdapter`/`BrokeredHarnessSession` 是否要转发；`harness-broker/src/protocol.ts` 的 `harnessBrokerMethodSchema` |
| 新增必需成员 | 不要这样做：会同时破坏约 15 个 Adapter、Fake、Broker 和已安装的第三方插件 |
| 新增 `HostEvent` / 字段 | `harness-broker/src/validation.ts` 的 `eventKeys` 白名单；`FakeHarnessSession`；protocol-core 投影 |
| 新增 `HostItem` 种类或 `HostItemUpdate` | `protocol-core/src/codex-ui-projector.ts`、host-runtime 投影、Fake 的发布辅助方法 |
| 新增 `HarnessErrorCode` | `harness-broker/src/validation.ts` 的 `harnessErrorSchema` 枚举 |
| 新增 `HostCommand` | `execute` 重载；Broker 的 `brokerHostCommandSchema` 和 `server.ts` 的分派 |
| `HostUsage` 字段 | `usage.ts` 中 `usageFields` 及对应数值约束（`parseHostUsage` 对未知字段直接抛错） |
| 插件上下文 `HarnessPluginContext` | host-runtime `installed-harness-plugins.ts` / `harness-plugin-loader.ts`；它只能放构造参数，注释写明"never contains Host or Renderer internals" |

契约**不向 Adapter 暴露 Host 或 Renderer 内部**；Harness 专属的东西放在对应 Adapter 里，不要为了一个 Harness 往公共类型里加字段。确实需要的新能力按"可选接口 + inspect 能力位"的模式添加（参考 `HarnessSessionImportCapability.resolveCandidate?`，注释："Omission keeps older discovery-only plugins valid, not importable."）。

## `build-plugin.mjs` 的约束

- 以 `platform: "node"`、`target: "node22"`、`packages: "bundle"` 打包插件，注入 `createRequire` banner，并检查 metafile：输入里出现 `test/`、`tests/`、`tools/` 或 `@anthropic-ai/claude-agent-sdk-` 平台子包时直接失败；不在 `allowedRuntimePackages` 中的 node_modules 包报 "unreviewed runtime package"；产物里不能有 `sourceMappingURL=`。
- manifest 先经 `harnessPluginManifestSchema` 校验，资源路径要用 `realpath` 确认位于插件目录内。
- 给插件增加运行时依赖时，更新 `scripts/release/harness-plugins.json` 的 `runtimePackages` 允许列表；`tools/build-cursor-plugin.mjs` 另有一份独立列表。不要放宽这里的检查。
