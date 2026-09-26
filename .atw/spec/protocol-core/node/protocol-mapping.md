# 协议映射约定

## 解码 Desktop 请求

- Codex wire 使用手写的类型守卫（`isRecord`、`optionalText`、`nullableText`），不用 zod 整体解析。原因是 Desktop 版本升级会新增字段，而 Host 需要自己决定是否仍能处理。ID 这类公共值仍用 `shared-contracts` 的 schema（例如 `hostTurnIdSchema.parse`）。
- `decodeXxxRequest(request)`：`request.method` 不匹配时返回 `null`，参数非法时抛出 `Error`，message 格式固定为 `"<method> params.<field> must be …"`（见 `thread-fork.ts`）。
- 遇到未知字段时，不猜测它的含义：`decodeThreadListRequest` 发现 `THREAD_LIST_FIELDS` 之外的字段就置 `supportsExternal=false`，让官方透明处理，不合并外部 Thread（测试 "omits External aggregation for future filters and legacy official cursors"）。`section_position` 排序同样只交给官方处理。
- Host 自己签发的分页游标格式是 `codexhost:thread-list:v1:` 加 base64url 编码的 JSON，里面同时记录官方游标和外部锚点，上限 65 536 字符。`decodeHostThreadListCursor` 会核对查询的 sha256 指纹（`queryFingerprint`）和排序方向，对不上就拒绝。游标只是运输载体，不含签名，不能当作权限凭据。

## 路由编码（`model-routing.ts`）

- `decodeCreateRoute` 的判定顺序是：先插件路由 `codexhost/plugin-v1@…`，再依次尝试 7 种旧专用编码（`codexhost/<id>-native[@model[@…]]`），然后是裸的旧 Transport ID，都不匹配时视为 `{ harnessId: "codex" }`。
- `ExternalHarnessId` 是开放的 `string`。`EXTERNAL_HARNESS_IDS` 和 `transportModelByHarness` 只是旧名单，注释写明安装与否由 Host Registry 判定，不以这份名单为准。
- 带旧前缀但格式非法的值必须**抛错**，不能当作官方 Model 转发（测试 "rejects malformed selected Claude/Pi carriers instead of forwarding them as official Models"）。
- 旧编码只能加读取兼容，不能删除。例如 "still decodes Antigravity carriers written before efforts existed"：已持久化的 `transportModelId` 必须还能解析。新增维度时，旧格式要继续可解码。
- 插件路由是运输用的编码，**不是加密**，不能放入凭据（`docs/architecture/harness-plugin-runtime.md`）。

## Turn 投影（`codex-ui-projector.ts`）

- `CodexTurnProjector` 每个 Host Turn 一个实例，执行严格的状态机：
  - 事件的 `turnId` 与实例不符时抛出 "references another Turn"；
  - 终态之后再收到事件时抛出异常；
  - `turn.completed` 时如果仍有未关闭的 Interaction 或 Item，也抛出异常。
  Host 捕获这些异常后当作投影故障处理。**不要为了"容错"吞掉顺序错误。**
- 实时投影与 `projectHistoricalTurn` 必须输出相同的 Desktop 文本。历史路径从完整 Snapshot 一次性投影，不重放通知（测试 "projects a complete historical Snapshot without replaying notifications"）。
- 以下 Desktop 渲染上的限制已写在注释里，改动时不能破坏：
  - Desktop 只为 Command Execution 渲染可展开的详情卡片。`toolCommandLine` 会把 Read/Glob/Grep/shell 类通用工具提升成命令卡片；识别依据是规范化后的工具名集合，而不是 Harness 名称。
  - Reasoning 的 summary 在 Desktop 中只是临时的单行预览，Turn 结束后不保留，因此每个 Reasoning Item 还会投影一个 `commandExecution` 的"transcript twin"，其 `command` 为 `shared-contracts` 的 `REASONING_TRANSCRIPT_COMMAND`，由 `renderer-extension/src/renderer-transcript-dom.ts` 识别渲染。twin 沿用原 itemId，预览使用 `reasoningPreviewItemId` 派生出的 id。**这三处必须一起改。**
  - 空的 Reasoning Item 推迟到出现真实文本后再发出 wire Item，避免出现空卡片。
  - 一个 Item 只有一份配置，不能把第一个子项的配置算到整个异构 Subagent 组上。
- 不编造数据：无效的原生耗时不补算 duration（"does not invent historical duration from invalid native timing"），只有周窗口的账号不生成五小时窗口（`codex-native-usage` 测试）。

## 文件变更汇总（`file-change-summary.ts`）

- 只使用原生 patch 提供的行，不读取文件系统快照，也不编造上下文（注释 "no filesystem snapshot or invented context"）。
- 没有共同坐标的片段（`diffScope: "fragment"`）无法合成净 patch，按原样归到同一个文件下，不能丢弃。
- 路径键 `filePathKey`：只要 cwd 或文件是 Windows 盘符路径，就用 `path.win32` 解析并转成小写；POSIX 路径保持大小写敏感。
- 已知性能债：`#fileChangeUpdates` 每次更新都重新计算（注释中的 ponytail）。只有在大 Turn 被实测证明慢时才加缓存。

## Interaction 投影

- `projectCodexApprovalRequest`：先校验动作 ID 唯一、标签非空。同一个 effect 出现多个动作时，走表单选项 `projectApprovalChoices`；否则要求 `allowOnce` 和 `deny` 恰好各一个，`allowForSession` 和 `allowAlways` 最多各一个。展示文本超长时截断加 `…`，**只有空文本才报错**（注释说明：长命令或长路径必须能进入审批对话框）。
- 回复解析 `parseResponse` 对非法结构抛出 `Codex Approval response is invalid: …`，Host 据此按 deny 处理（见 host-runtime error-handling 的 fail-closed 一节）。
- `projectCodexQuestionRequest` 的 Question 列表不能为空；secret Question 失败时不修改合成 Item 的状态（测试 "fails a secret Question without mutating synthetic Item state"）。

## Usage

- `observeCodexRateLimits` 只采用账号级别的 `codex` bucket，忽略 `rateLimitsByLimitId` 中按模型区分的 bucket（例如 GPT-5.3-Codex-Spark），也忽略按模型区分的滚动通知。
- 无法识别的通知返回 `null`，不抛出异常。观测类函数属于尽力而为的读取。

### Scenario: Codex 重置卡明细（`observeCodexRateLimitResetCredits` → `projectCodexRateLimitsToCredits`）

1. **Scope / Trigger**：官方 `account/rateLimits/read` 响应（或 `params`）里的 `rateLimitResetCredits` 投影到跨层契约 `AccountCreditsSnapshot.resetCredits`，Renderer 据此画逐张寿命横条。
2. **Signatures**：`observeCodexRateLimitResetCredits(value: unknown): CodexRateLimitResetCredits | null`；`CodexRateLimitResetCredits = { availableCount; nextExpiresAtUnix?; expiresAtUnix?: number[]; credits?: { expiresAtUnix: number; grantedAtUnix?: number }[] }`。`projectCodexRateLimitsToCredits(usage, resetCredits?)` 把 Unix 秒转 ISO。
3. **Contracts**：官方（codex-cli 0.156.1 `generate-ts`）`RateLimitResetCredit = { id, resetType, status, grantedAt: number /*秒*/, expiresAt: number | null, title, description }`，`credits` 可为 `null`（只知张数）且可能被后端截断。输出契约 `accountResetCreditsSchema`：`availableCount`（正整数）、`nextExpiresAt?`、`expiresAt?: string[]`（旧字段，保留兼容）、`credits?: { expiresAt: string; grantedAt?: string }[]`，两个数组上限 `ACCOUNT_RESET_CREDITS_MAX_LENGTH = 32`，时间字符串上限 `ACCOUNT_RESET_CREDIT_TIME_MAX_LENGTH = 64`。
4. **Validation & Error Matrix**：`availableCount` 缺失/非法/0 → 返回 `null`（Renderer 不显示区域）；`status` 存在且不是 `"available"` → 跳过；`expiresAt` 非非负安全整数（含 `null` 永不过期）→ 跳过该卡（只计入张数）；`grantedAt` 非非负安全整数或 ≥ `expiresAt` → 保留卡、省略 `grantedAtUnix`；超过 32 张 → 按到期升序保留前 32 张，`availableCount` 不变。
5. **Good/Base/Bad**：Good — 两张可用卡都带 `grantedAt`，按到期升序输出 `credits` 与同序 `expiresAtUnix`；Base — `credits: null`，只输出 `availableCount`；Bad — `grantedAt: "1000"` / `-1` / 等于到期，卡照常输出但没有 `grantedAtUnix`。
6. **Tests Required**：`protocol-core/test/codex-native-usage.test.ts`（排序、过滤已兑换卡、异常发放时间、32 张截断、ISO 投影）；`host-runtime/test/account-rate-limits.test.ts`（缓存保留 `credits`）；`shared-contracts/test/thread-usage.test.ts`（新字段通过、空数组/缺到期/未知字段/超长/超 32 张被拒）。
7. **Wrong vs Correct**：
   - Wrong：`grantedAt` 缺失时用 `now` 或 `expiresAt - 30 天` 补齐，Renderer 会画出编造的比例。
   - Correct：只在 `0 ≤ grantedAt < expiresAt` 时带 `grantedAtUnix`，否则省略，由 Renderer 只显示到期时间。

## JSONL（`jsonl.ts`）

- `readLfFrames` 只在新收到的数据块中查找换行，跨块帧合并一次，复杂度保持线性。`maxFrameBytes` 按单帧计算，默认不设上限，原因是官方历史响应可能超过 128 MiB（`docs/architecture/app-server-transport.md`）。**不要给 Desktop 与官方之间的转发加帧大小上限，也不要截断内容。**
- UTF-8 使用 `fatal: true` 解码。数据结束时仍有未以换行结尾的尾段要报错。
- 回归测试：`packages/protocol-core/test/jsonl.test.ts`，以及 `packages/host-runtime/test/remote-official-connection.test.ts`（其中包含超过 128 MiB 的真实 WebSocket 响应）。
