# OpenCode 历史、Fork/回滚与 Diff

## Native Ref 与身份（`history.ts`）

- Native Session Ref 的 `locator` 为 `{ directory, executionPolicy }`，由 zod `strictObject` 校验。旧 Ref 缺 `locator` 时按 `executionPolicy: "default"` 处理。这是本包唯一直接使用 `zod` 的地方，但 `package.json` 没有声明 `zod` 依赖（它经由 workspace 提升和发布 `runtimePackages` 才能解析）。要在本包新增 zod 用法，先补上依赖声明。
- Turn 身份：`nativeTurnKey` 是 user message ID；Item id 直接使用 OpenCode 的原生 Part/Message ID，保证 SSE 重连前后不重复。`fileChange` Item 的 id 是 `opencode-diff:<userMessageID>`，并通过 `sourceItemIds` 关联本 Turn 的工具项。
- **Checkpoint 是该 Turn 最后一个 Assistant message ID**（`projectOpenCodeHistory` 中的 `terminal.id`），不是 user message。这与 Pi/OMP 用 user entry id 不同。
- 历史事实来源是持久化的 message 与 part（`getMessages`），不重放临时 SSE 文本。Model/variant 从 `metadata["codexhost.selection.v1"]` 恢复，因此还没发出下一条消息的 Session 在 Resume 后也能保留选择。

## Fork 与回滚上一轮（`history-derivation.ts` 的 `deriveOpenCodeHistory`）

两者都通过原生 `session.fork({ messageID })` 派生一个**独立的新 Session**。该 API 复制 `messageID` **之前**的消息（exclusive 边界）。

| 操作 | 边界 |
|---|---|
| Fork 到 checkpoint | `resolveOpenCodeForkBoundary`：取 checkpoint Assistant 之后的第一条消息作为 `messageID`；checkpoint 已是最后一条时省略 `messageID` |
| 回滚上一轮 | `resolveOpenCodeLastTurnBoundary`：以最后一条 user message 作为 `messageID` |

派生流程中的不变量，改动时必须全部保留：

1. 源 Session 必须处于 `idle`，否则报 “source Session is busy”。
2. 派生前用 `readProjection(..., { strictFileChanges: true })` 读取源，并对预期状态做 `structuredClone` 冻结（注释：原生客户端或测试 transport 可能修改返回的对象）。
3. 候选 ID 必须不同于源 ID，`directory` 必须不变；随后补写 selection metadata，并把 permission 规则集复制成与源一致。
4. 派生后并行重读候选和源，逐项深比较：候选的语义历史等于源前缀，源状态未变，Model/variant/permission 一致，两者都处于 `idle`。任一项不符就报 `protocolError`。
5. 失败时 `OpenCodeAdapter.open()` 只删除 `createdForCleanup` 记录的候选 Session。原生 Revert/Unrevert 仍在 transport 上，但**不用于消息编辑**：它会改动真实文件，而消息编辑只替换会话历史，不撤销工作区修改。

- 跨 cwd：`open()` 比较源 `session.directory` 与请求的 cwd（`sameCwd` 走 realpath，修复过 macOS `/var` 与 `/private/var` 别名导致的误拒绝），不同就返回 `unsupported`，resume 也不例外。能力声明为 `forkAcrossCwd: false`。
- Fork 出来的 Session 没有 `parentID`；`parentID` 只用于 Task 子会话，不能拿它判断 Fork 血缘。本包目前不声明 `subagents` 能力，Task 工具按普通工具展示。

## Diff / FileChange（`history-projection.ts`、`file-change-verification.ts`）

- 来源：`session.diff({ messageID: userMessageID })`。`reliableOpenCodeFileChanges()` 只接受 `file`、`status`、`patch` 都齐全的条目，不用增删行数去猜路径或补丁。
- 原生 summary 持久化会落后于终态 Patch Part，所以 `readTurnDiff()` 按 `[25, 50, 100, 200, 400, 800]` ms 重试，直到可靠 Diff 覆盖该 Turn 所有 `patch` Part 中的文件。
  - 非严格模式（实时/快照）：重试用尽后按现有结果返回。
  - 严格模式（派生校验）：要求每个路径都经 `openCodeFileIdentity()` 解析到 worktree 内部，且全部被覆盖，否则报 `protocolError`。
- `verifiedOpenCodeWorktree()` 要求 Session directory 与原生 `path.directory` 的 realpath 相等，并且位于 `worktree` 之内；任何路径含 `.`/`..` 段、NUL 或换行都视为不可信。

## Usage（`usage.ts`）

按 Assistant message 的 `tokens.input/output/reasoning/cache.read/cache.write` 和 `cost` 累加。上下文用量 = 最新一条的 input + cache.read + cache.write；上下文窗口取自当前 Provider Model 的 `limit.context`。`cost` 是 OpenCode 的估算值，不要当作账单（Billing Source）展示。
