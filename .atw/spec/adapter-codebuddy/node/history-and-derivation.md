# CodeBuddy：原生历史、Fork 与修订

## 原生历史格式（`history.ts`）

- 位置：`<configRoot>/projects/<projectSlug>/<nativeSessionId>.jsonl`。`configRoot` 取 Profile 的 `configDirectoryEnvironmentVariables` 中第一个非空值，否则为 `~/<defaultConfigDirectoryName>`。
- `projectSlug` 基于 `codeBuddyCanonicalCwd`（`realpathSync.native`，失败时退回 `path.resolve`）。CodeBuddy 默认编码为非字母数字转 `-`、合并、去首尾并转小写；Profile 可以用 `projectDirectoryName` 覆盖（WorkBuddy 保留大小写与 Unicode）。
- 文件是 append-only 的，多个分支共存。**当前对话 = 从最后一个叶子沿 `parentId` 回溯的链**（`nativeHistoryRows`），只计入 `message` / `reasoning` / `function_call` / `function_call_result` 四类记录，每条都必须有稳定 `id`。出现环或缺失父节点时报 `protocolError`。
- `resend-fork-notice` 记录把叶子重置到它的 `parentId`，代表一次原生回退。**原生新进程 load 时可能忽略这条通知**，所以 `pendingNativeHistoryRewind` 会检查最后一条“消息或回退”记录是否仍是通知；是的话，Session 打开后必须重新 rollback（`session.ts` 的 `#openClient`）。标题、摘要、文件快照不影响这个判断；后面一旦出现新的消息，该分支就已锚定，不再回退。
- Turn 身份就是持久化的用户消息 ID；Checkpoint 使用同一个 key（`retainedRowCount` 用 `checkpoint.checkpointId` 对比 `nativeTurnKey`）。
- Tool 的调用与结果由原生的两个写入方分别写入，结果可能先于调用落盘（例如 Tool 在执行前被拒绝）。投影时要先暂存这类结果，等调用出现后再关联；调用始终没有出现的结果直接丢弃，不要让整次读取失败（`snapshotFromHistory` 注释）。
- 只有手动 `/compact` 会产生命令 Turn。原生自动压缩也有一条内部用户 Prompt，但它不能切分当前用户 Turn。

## 归属校验（读取即校验）

`codeBuddyHistory` 按以下顺序校验，任何一步失败都报错，不做容错：

1. `validateNativeRef`：Harness ID 匹配、`formatVersion === 1`、Session ID 满足 `^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$`。
2. 优先使用主路径；主路径不存在时扫描所有项目目录，找到的结果必须恰好 1 个（`Ambiguous Native Session history`）。支持 Fork 的 Profile 在非事务读取时，要求文件就在请求 cwd 的主路径下。
3. 文件上限 64 MB；每一行都必须是合法 JSON。只有 `codeBuddyLiveNativeHistory`（子任务实时观察）允许忽略末尾那一行尚未写完换行的记录。
4. 每行的 `sessionId` 必须等于 Ref，每个 `cwd` 必须与请求 cwd 解析到同一个真实路径（Windows 下不区分大小写）。
5. 派生 Session 的 locator（`codebuddyDerived: 1` 加 `boundCwd` / `targetProjectSlug` / `inheritedPrefixRows` / `inheritedPrefixSha256` / `bindingMarkerId`）必须全部存在或全部不存在，只填了一部分就报 `protocolError`。继承前缀用 SHA-256 固定，后续追加的内容必须来自目标 cwd。

## 派生：Fork 与 rollbackLastTurn（`derivation.ts`）

ACP 没有 `session/fork`；带 `--resume --fork-session` 启动 ACP 也不会复制历史。实际流程由 `deriveCodeBuddySession` 编排，是一个多进程事务，最终返回一个 `kind: "resume"` 的 `OpenSessionInput`：

1. `retainedRowCount`：Fork 保留到 checkpoint 所在 Turn 的末尾（包括 Tool 结果后缀）；rollbackLastTurn 保留到最后一个 Turn 之前（可以为空）。另外去掉紧挨边界的 local-command caveat 记录。
2. **无模型复制**：`codebuddy --resume SRC --fork-session --session-id TMP --print --input-format stream-json --output-format stream-json`，stdin 立即 EOF。输出必须满足：`init.session_id` 和 `result.session_id` 都是 TMP、`is_error === false`、`duration_api_ms === 0`。输出上限 64 MB，超时 30s。
3. 复制品的父链必须与源完全相等。这个复制品**不能直接当可写 Session 用**：它的运行时身份仍来自继承的 `sessionId` 行，新事件和子 Agent 会写回源 Session（docs 中记录的 2.151.0 实测失败）。
4. 用 `CodeBuddyCopyCleanup` 启动管理用 ACP 进程（`--acp --serve --host 127.0.0.1 --port 0 --auth password`，随机密码通过环境变量传入）。load TMP 后，确认实时命令目录中有 `fork`，再发送 Prompt `/fork`，从 `_meta["codebuddy.ai/sessionReset"]` 拿到最终 ID。
5. `assertCopiedPrefix`：比较每条记录去掉 `id` / `parentId` / `logicalParentId` / `sessionId` 之后的内容，并按 ID 映射核对两条父边（原生 `/fork` 会重新生成 ID）。
6. 对最终 Session 调用 `_codebuddy.ai/session/rollback` 回到保留点，确认 `applied` 与 `actualForkPointId`，再读回历史，要求与预期前缀逐行相等。
7. 复制保留前缀中 Agent 结果引用的子 Transcript（`copyInheritedChildren`）：按 `callId` 关联调用与结果，由 `subAgent.sessionId` 和包含式的 `lastId` 确定范围，以排他方式创建（`wx`）并设为 `0600`。原因是 `--fork-session` 和 `/fork` 都不复制 `subagents/`。
8. 再读一次源历史，与开始时的字节比较，不同就报 `sessionBusy`（`Source history changed during Fork`）。
9. `finally` 中通过本地 HTTP `DELETE /api/v1/sessions/{TMP}` 删除临时复制品，关闭管理进程，清理桥接文件；派生失败时按逆序删除已复制的子 Transcript。清理失败会带上临时 Session ID 一起报出（`AggregateError`）。

配置继承：源 Session 已打开时，沿用它当前确认过的 Model / Thinking / Permission；rollbackLastTurn 的显式设置优先；否则读取 locator 里保存的 `configuration`。

## 常见坑

- 永远不要直接编辑、截断或删除原生 JSONL 来“实现”回退。唯一的例外是 `cleanupBridge`：它只删除本包自己排他创建、内容仍与写入时完全一致、权限仍为 `0600` 的桥接文件或子 Transcript 副本。
- `copy-cleanup.ts` 会过滤 `--serve` 的启动横幅，因为横幅里含密码。只有以 `{` 开头的行才会交给 ACP 解析器；新增的 stdout 处理不能绕过这层过滤。
- 原生 CLI 拒绝删除当前活动的 Session。因此在 `/fork` 切换活动 Session 之前失败时，临时复制品可能残留。这是已知行为，报错里要保留临时 ID，不要改成静默忽略。
- 已经在错误分支上续写的旧 Session 不会被自动修复，应该从正确的 checkpoint 重新派生。
- POSIX 权限位检查（`0o077`、uid）只在非 Windows 平台执行；Windows 依赖目录 ACL，测试中用 `process.platform` 做分支（例如 `packages/adapters/workbuddy/test/history-derivation.test.ts` 的 `it.runIf`）。
