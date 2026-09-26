# Local Usage：原生用量读取与用量查询

产品行为见 `docs/product/local-usage.md`，决策见 `docs/adr/0001-*`、`0002-*`。本文是跨 Adapter → Host → Renderer 的可执行契约。

## 1. Scope / Trigger

- 修改 `HarnessAdapter.nativeUsage`、`LOCAL_USAGE_QUERY_METHOD` 的参数/结果、`host-runtime/src/local-usage-*.ts`（含计价与价格来源）、`host-runtime/src/codex-runtime/codex-native-usage.ts`（官方 Codex rollout 读取）、Renderer 用量页，或新增一个 Harness 的原生用量读取时阅读。
- 这是跨层契约：Adapter 输出 → Host 校验、去重、持久化 → shared-contracts 结果 schema → Renderer 渲染，任一层改字段都要同步其余三层。

## 2. Signatures

```ts
// harness-adapter/src/text-session.ts（可选能力，旧插件缺省仍有效）
interface HarnessAdapter { readonly nativeUsage?: HarnessNativeUsageCapability }
interface HarnessNativeUsageCapability {
  read(cursor: JsonValue | null): Promise<HarnessResult<HarnessNativeUsageBatch>>;
}
interface HarnessNativeUsageBatch { records: readonly HarnessNativeUsageRecord[]; cursor: JsonValue }
interface HarnessNativeUsageRecord {
  dedupeKey: string; occurredAt: number /* epoch ms */; nativeSessionId: string;
  provider?: string; model?: string /* 只计对话时省略 */; cwd?: string;
  tokens: { input /* 不含缓存 */; cacheRead; cacheWrite; output; reasoning /* 单独上报才非 0 */ };
  conversations: number;
  reportedCostUsd?: number;  // Harness 自己算出的费用；未知就省略，不能用 0 表示未知
}

// host-runtime
class LocalUsageService {                        // local-usage-service.ts
  constructor(input: { adapters: ReadonlyMap<string, HarnessAdapter>;
    officialCodexUsage?: HarnessNativeUsageCapability;  // 生产传 codexNativeUsage(permanentHome)
    descriptors(): readonly HarnessPluginDescriptor[]; directory: string;
    fetchLiteLlm(): Promise<unknown>;   // 生产传 fetchLiteLlmPrices，测试注入
    diagnose(error: unknown): void; now?(): number });
  handle(request: JsonRpcRequest): Promise<JsonObject>;   // { result } | { error }
}
applyNativeUsageBatch(state, harnessId, batch): void      // local-usage-store.ts，先校验后修改
buildLocalUsageView({ buckets, period, timeZone, now, harnessName, price }): LocalUsageQueryResult // local-usage-view.ts，纯函数
defaultLocalUsageDirectory(env) // ${CODEXHOST_DATA_DIR:-~/.codexhost}/usage
writeUsageFile(file, value)     // local-usage-store.ts：临时文件 + rename，目录 0700、文件 0600

// local-usage-pricing.ts（纯函数）
interface ModelPrice { input; output; cacheRead; cacheWrite }   // USD / token，LiteLLM 未列出的种类为 0
type ModelPriceTable = ReadonlyMap<string /* 小写模型名 */, ModelPrice>;
type ModelPricer = (model: string) => ModelPrice | null;        // null = 无价格
createModelPricer(litellm, manual = { overrides: MODEL_PRICE_OVERRIDES, aliases: MODEL_ALIASES }): ModelPricer
usageCostUsd(tokens, price | null): number                      // 无价格为 0

// local-usage-prices.ts
parseLiteLlmPrices(raw: unknown): Map<string, ModelPrice>
loadModelPrices({ directory, now, fetchLiteLlm, diagnose }): Promise<{ prices; refreshAfter }>  // 永不抛错
fetchLiteLlmPrices(): Promise<unknown>   // GET LITELLM_PRICES_URL，10 s 超时
modelPriceRecord(prices, fetchedAt): ModelPriceRecord   // 缓存文件与内置快照同形

// codex-runtime/codex-native-usage.ts（官方 Codex 没有 Adapter，ADR-0002）
codexNativeUsage(codexHome): HarnessNativeUsageCapability   // 抛错映射为 { ok:false, code:"unavailable" }
readCodexNativeUsage(codexHome, cursor): Promise<HarnessNativeUsageBatch>

// app-server-host.ts 只有一行分派 + #handleLocalUsage（waitForPlugins → service.handle → rpcEnvelope）；
// codexHome = this.#officialRuntimeScope.permanentHome（= path.resolve(CODEX_HOME ?? ~/.codex)）
// Renderer：RendererModelClient.queryLocalUsage?(params)；设置页 createUsageSettingsPage(messages, getClient)
```

## 3. Contracts

- 记录**不带 Harness 字段**：Host 用 adapters Map 的键归属记录，Adapter 无法冒充其他 Harness。`officialCodexUsage` 的记录固定归属 `"codex"`（插件 ID schema 保留了该 ID，不会与插件冲突），显示名在没有同 ID 描述符时为 `"Codex"`。
- `cursor` 对 Host 不透明，Host 原样持久化；Adapter 不保存读取状态。无法识别的游标 = 从头读。允许重复返回已读记录，Host 按 `dedupeKey` 每个 Harness 只计一次（先到先得）。因此 Adapter **只能交出终值**：可能仍在增长的记录（例如流式中的回复）要等到终值再交出，把游标退回到它的第一行。
- 请求 `codexhost/usage/query`：`{ period: {kind:"day"|"week"|"month"|"total"} | {kind:"custom", from, to}, timeZone: IANA, refresh: boolean }`，全部 strict。日期 `YYYY-MM-DD` 且是真实日历日；自定义 `from ≤ to`，跨度 < 3660 天。
- 结果（strict）：`range{from,to}`、`totals{total,input,cacheRead,cacheWrite,output,reasoning,conversations}`（refine：`total` = 五项之和）、`estimatedCostUsd`（非负有限数，所选范围的 Estimated Cost，USD）、`models`、`harnesses[{harnessId,name,totalTokens,models}]`（`harnessId` = `"codex"` | 插件 ID；按用量降序，只含 Token > 0 的 Harness）、`daily[{date,total,input,output,cacheRead,reasoning,conversations}]`（有 Token 或对话的日期，倒序）、`stats{last7Days,last30Days,dailyAverage,activeDays,firstActiveDate}`。不含正文、会话 ID、工作目录。
- `stats`（统计块，与所选周期无关，由 `local-usage-view.ts#usageStats` 从**全部**桶按请求时区归日后计算）：活跃日 = 当天 Token > 0 且不晚于今天（只有对话的日期、时钟偏差产生的未来日期都不算）；`last7Days`/`last30Days` = 今天往前 7/30 个日历日（含今天）的 Token 总数；`dailyAverage` = `Math.round(last30Days ÷ 其中活跃日数)`，无活跃日为 0；`activeDays`/`firstActiveDate` 覆盖全部已统计历史，不受「总计」24 个月限制，无历史时 `0`/`null`。schema `superRefine`：`firstActiveDate === null` ⇔ `activeDays === 0`；`last7Days ≤ last30Days`。统计块「对话数」不在 `stats` 中，Renderer 用 `totals.conversations`（所选范围之和）。
- 计价（Estimated Cost，查询时计算，不写入桶，价格更新后历史范围的费用随之变化）：
  - 每个范围内的桶：有 `reportedCostUsd` 用它（包括 0，例如订阅通道）；`model === null`（只计对话）为 0；否则 `usageCostUsd(bucket, price(model))` = `input×in + cacheRead×cacheRead + cacheWrite×cacheWrite + (output + reasoning)×out`。推理不重复计由记录契约保证：`tokens.reasoning` 只在 Harness 单独上报时非 0（`text-session.ts` 注释），已含在输出中的推理（Claude Code 思考、Codex 的 reasoning 子集）Adapter 必须报 0 或从 output 中扣除，不能两边都报。
  - 模型名匹配（`trim().toLowerCase()`，结果按名缓存）依次：精确 → 别名（只查原名）→ 去装饰后缀（反复去掉 `[…]`、`:…`、`-minimal|low|medium|high|xhigh|max|thinking`，不去 `-fast`，它常是独立 SKU）→ 去厂商前缀（模型取最后一个 `/` 之后；价格表中只有带前缀条目时取键名排序最小者，保证确定性）→ 最长包含名兜底（只考虑长度 ≥ 5 且含字母和数字的名称）。每一步都先查 `MODEL_PRICE_OVERRIDES` 再查 LiteLLM；因此覆盖表中 `claude-opus-5` 不会压过 LiteLLM 里精确存在的 `claude-opus-5-fast`。覆盖表与别名表是随版本维护的源码常量，当前为空（本机所见模型 LiteLLM 都能匹配），不是用户可编辑文件。
  - 价格来源（`loadModelPrices`）：`<directory>/model-prices.json` 且 `now - fetchedAt < 24h` → `fetchLiteLlm()` 解析出至少一个价格（成功写缓存，写失败只 `diagnose`）→ 过期缓存 → `LITELLM_PRICE_SNAPSHOT`。`refreshAfter` = 缓存 `fetchedAt + 24h` / 远程 `now + 24h` / 回退 `now + 1h`。只取 `mode` 为 `chat`、`responses`、`completion` 或缺省且有输入或输出价的条目，键小写、重复键先到先得，跳过 `sample_spec`。缓存格式 `{ formatVersion: 1, fetchedAt, prices: { [model]: [in, out, cacheRead, cacheWrite] } }`（USD/token），strict 校验，损坏则 `diagnose` 后视为无缓存。
  - Service 内：只有进程内第一次加载价格时 `handle` 等待（与读取并行，`Promise.all`）；之后价格过期时先用旧价格回答，同时在后台加载，下一次查询起生效；同一时刻只有一次加载。
  - 快照 `local-usage-price-snapshot.ts` 由 `node tools/update-model-price-snapshot.mjs`（先 `npm run build:typescript`）从 LiteLLM 生成，与远程使用同一个 `parseLiteLlmPrices`；已加入 `.prettierignore`，不要手改。
- 周期：周一为周首；`month` 为整月；`total` = 23 个月前当月 1 日到今天；日期由 Host 用请求的 `timeZone` 计算（`now` 为 Host 时钟）。
- 持久化：`<directory>/local-usage.json`，`{ formatVersion: 1, sources: {[harnessId]: {cursor, counted: string[]}}, buckets: [...] }`，`counted` 是 `sha256(dedupeKey)` 的 base64url 前 16 位；桶 = UTC 半小时起点 × harnessId × provider × model × cwd × 是否自带费用。带 `reportedCostUsd` 的记录进入另一桶，桶上的 `reportedCostUsd` 累加其费用；不带的桶没有该字段（按价格计）。临时文件 + rename 原子写入，目录 0700、文件 0600。
- `refresh:true` 读取新增记录；`refresh:false` 若有进行中的读取则等待它，否则用内存状态，再否则用磁盘状态，都没有才读取。并发读取共享同一个 Promise；每次读取先从磁盘加载，采纳其他 Host 进程的进度。
- Renderer 用量页始终用本地 Host（`modelClientForHost("local")`），打开时 `refresh:true`，切换周期/应用自定义 `refresh:false`，刷新按钮 `refresh:true`。

- 官方 Codex rollout（`codex-native-usage.ts`，格式细节只在此文件）：
  - 文件：`<codexHome>/sessions/**/rollout-*.jsonl` 与 `<codexHome>/archived_sessions/**/rollout-*.jsonl`，按**文件名**排序处理（文件名以创建时间开头，父会话先于 Fork）。游标 `{ formatVersion: 1, files: { [相对 codexHome 的路径]: { ino, offset, state } } }`，`state` = `{ sessionId, historyId, provider, model, cwd, total }` 保存读到 offset 为止的上下文；inode 变化、文件变短或路径变化（归档移动）从头重读，靠 `dedupeKey` 不重复计。只读完整行。
  - 上下文：第一条 `session_meta` 是本文件自身（`sessionId` = `payload.id`、`provider` = `model_provider`、`cwd`）；**每条** `session_meta` 更新 `historyId`（Fork 在自身元数据后重放父会话的 rollout，第一行就是父会话的 `session_meta`）；`turn_context` 更新 `model`、`cwd`（模型取最近一次 turn_context）。
  - 用量：只看 `event_msg` 中 `payload.type === "token_count"` 且有 `info.total_token_usage` 的事件（`info: null` 的限额事件跳过）。delta：累计值与上次相同 → 0；有上次累计值、本次累计值 ≠ 本次 `last_token_usage` 且五项都不小于上次 → 差分；否则（文件内首次、累计值变小、或重启后恰好 total == last）→ `last_token_usage`（缺省用 total）。每次都把 `total` 记为新的基线。
  - 映射：Codex 的 `input_tokens` 含 `cached_input_tokens` 与 `cache_write_input_tokens`（`total_tokens = input + output`），`reasoning_output_tokens` 含在 `output_tokens` 中 → `cacheRead = cached`、`cacheWrite = cacheWrite`、`input = input − cached − cacheWrite`、`output = output`、`reasoning = 0`。delta 全 0 不产生记录；每条非零记录 `conversations: 1`（对话数 = 非零 token_count 事件数）。不填 `reportedCostUsd`。
  - `dedupeKey = token_count:<historyId>:<total 签名>:<last 签名>`，签名为五项以 `.` 连接。同一历史内累计值只增不减，因此 Fork 重放的副本与父会话记录同键，由 Host 去重只计一次（Fork 的 Fork 同理）。
  - `nativeSessionId` 始终是本文件自身的会话 ID；`occurredAt` 是行的 `timestamp`。

## 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| params 不合 schema（未知时区、非法日期、倒序或过长区间、多余字段、缺 `refresh`） | `-32602`，不触发读取 |
| 某 Harness `read` 返回 `ok:false` 或抛出 | 该 Harness 保留旧游标与桶，`diagnose`，其余 Harness 照常 |
| 某批记录不合 strict schema（负数、多余字段如正文） | 整批丢弃，同上 |
| 状态文件不存在 | 从头读取 |
| 状态文件损坏 | `diagnose` 后从原生记录重建 |
| `stats` 违反不变量（有活跃日却无开始日期、7 天 > 30 天） | 结果 schema 失败，按下一行处理 |
| LiteLLM 超时、HTTP 非 2xx、JSON 中没有任何可用价格 | `diagnose`，回退过期缓存或内置快照，查询照常返回 |
| `model-prices.json` 损坏或写入失败 | `diagnose`，忽略缓存 / 只用内存价格，查询照常返回 |
| 模型无价格（例如 `<synthetic>`、本地模型） | 该桶费用 0，不报错 |
| `CODEX_HOME` 下没有 `sessions/`、`archived_sessions/` | Codex 返回空批次，不出现 Codex 卡片 |
| rollout 读取期间被归档或删除（ENOENT） | 跳过该文件，其余照常；其他 IO 错误 → Codex 整批 `ok:false`，按「某 Harness 失败」处理 |
| rollout 行不是 JSON、缺时间戳或会话 ID | 跳过该行；token_count 仍推进累计值基线 |
| 状态文件读/写 IO 失败、结果 schema 或 view 构建抛错 | `-32082 "Local usage could not be read"`（handler 在 try 中覆盖所有分支，必须回复 Desktop） |
| Renderer 收到 `RendererMethodUnavailableError` | 显示「不支持」，而非「失败」 |

## 5. Good / Base / Bad Cases

- Good：UTC 周日 23:30 的回复在 `Asia/Shanghai` 算周一，在 `UTC` 算上周。
- Base：追加一条回复后 `refresh:true`，总数只增加新记录；被 fork/resume 复制到另一文件的旧行不重复计；重启（新 service 实例）后结果一致。
- Good（统计块）：今天 03-04（Shanghai），02-26 00:00 本地的记录计入 7 天，02-25 23:59 的不计；02-03 计入 30 天，02-02 不计；2024 年的记录不在「总计」里，但决定 `firstActiveDate`。
- Base（统计块）：本机无记录 → `stats` 全 0、`firstActiveDate: null`，Renderer 不画统计块；只有一天 → 7 天 = 30 天 = 日均 = 该天总量、`activeDays: 1`。
- Bad：Adapter 在回复仍流式时交出部分用量，Host 先到先得，最终用量被当作重复丢弃（少计）。
- Good（计价）：LiteLLM 价格次日翻倍，不重新读原生记录，同一周的费用在后台价格加载完成后翻倍。
- Base（计价）：离线且无缓存 → 内置快照，`claude-opus-5` 按 $5/$25 每百万 Token；LiteLLM 挂起时（已加载过价格）查询不等待。
- Bad（计价）：Adapter 对自己不认识价格的模型填 `reportedCostUsd: 0`，Host 会优先用 0，Estimated Cost 被低估；未知应省略字段。
- Good（Codex）：父会话 total 100 → 350，Fork 重放这两条再接 total 400（last 50）→ 父会话两条 + Fork 一条新记录，Host 总计不翻倍；本机真实数据 821 个事件与独立脚本求和完全一致。
- Base（Codex）：当前 Codex 的 Fork 不重放 token_count、累计值从 0 开始 → 第一条按 last 计入；累计值中途重启到比上次更大的值（total == last）→ 按 last 计入，而不是差分。
- Bad（Codex，已接受的取舍，用户确认）：父会话在被读取之前就被删除 → Fork 重放的用量按 Fork 时间计入一次；兄弟 Fork 在同一历史下 total 与 last 五项全相同 → 撞键少计（概率极低）。Rollout 中没有可靠的重放段结束标记，因此不按时间戳阈值硬跳过。

## 6. Tests Required

- `host-runtime/test/local-usage.test.ts`（主切入点，真实 `ClaudeCodeAdapter` + 临时目录 + `handle()`）：各周期 `range`、时区归日、totals 精确值、`harnesses` 与 `daily`；`stats` 的 7/30 天本地日边界、日均分母、只有对话的日期与未来日期不计、`firstActiveDate` 早于「总计」范围、`stats` 不随周期变化，以及无数据与仅一天两个边界；增量 + 复制去重 + 重启一致；并发共享一次 `read`；读取中 `refresh:false` 得到刷新后的值；不合规批次被隔离；view 失败返回 `-32082`；非法 params `-32602` 且未读取。
- 计价（主切入点内）：`estimatedCostUsd` 精确值（各周期、跨桶）、价格更新后历史费用变化且不重读、LiteLLM 挂起时不等待且只有一次加载、无价格模型记 0、自报费用优先（含 0）、离线用内置快照。
- `host-runtime/test/local-usage-pricing.test.ts`（纯函数）：精确/大小写、装饰后缀、双向厂商前缀与确定性选择、最长包含名、拒绝 `fast`/`o1`/空名等泛名、别名、覆盖在每一步优先、费用公式与推理按输出价、无价格 0。
- `host-runtime/test/local-usage-prices.test.ts`：解析过滤、24 h 内缓存不联网、过期缓存联网并写缓存、联网失败用过期缓存、无缓存无网用快照、无价格响应视为失败、损坏缓存被忽略，以及各情形的 `refreshAfter`。
- 各 Adapter 的解析测试（例如 `claude-native-usage.test.ts`）：重复行去重、增量只读完整行、流式等待、记录不含正文。
- `host-runtime/test/codex-native-usage.test.ts`：累计差分、缓存扣除（含 cache write）、推理为 0、模型/工作目录取最近 turn_context、Provider 取自身 session_meta、重复累计值与 `info` 缺失不计、archived_sessions、增量与半行、未知游标重读键不变、Fork 与 Fork 的 Fork 重放同键、累计值重启（变小与 total == last）按 last、归档移动同键、无目录空批次、不含正文。
- 主切入点内的 Codex 用例：`officialCodexUsage` 注入真实读取器，断言 Codex 卡片 `{harnessId:"codex", name:"Codex"}`、Fork 重放不翻倍、增量追加、`reasoning` 为 0、费用只按输出价、每日明细与对话数。
- `shared-contracts/test/local-usage.test.ts`：params/结果 schema 边界、`harnessId` 接受 `"codex"` 与插件 ID 而拒绝空串/大写/非法 ID、`total` refine、`stats` 的两条 `superRefine` 与非整数/非法日期/多余字段，`estimatedCostUsd` 负数/无穷/NaN/字符串/缺失被拒。
- Renderer：`usage-dashboard.test.ts`（假 DOM 结构与格式化；费用 `formatUsageCost`：`$0.00`、`<$0.01`、`$1,234.57`，位于总数与起止日期之间且没有「估算」说明；统计块顺序、卡片与明细之间的位置、范围为空时仍显示、无历史时省略）、`usage-page.test.ts`（请求参数与刷新语义）、`renderer-model-client.test.ts`（方法与结果校验）、`tests/e2e/renderer-settings-usage.spec.ts`（放大尺寸、深浅色、窄窗口无横向溢出，本地运行）。

## 7. Wrong vs Correct

```ts
// Wrong：刷新进行中直接用旧状态回答周期切换，runLatest 又丢弃了刷新结果，页面停在旧数据
const state = params.refresh ? await this.#read() : (this.#state ?? (await this.#initial()));

// Correct：先等进行中的读取
const state = params.refresh
  ? await this.#read()
  : await (this.#reading ?? this.#state ?? this.#initial());
```

```ts
// Wrong：先累计活跃日再排除未来日期，时钟偏差的记录进了 activeDays/firstActiveDate 却不在 7/30 天里
stats.activeDays += 1;
if (date > today) continue;

// Correct：未来日期在所有统计块中一起排除
if (total === 0 || date > today) continue;
stats.activeDays += 1;
```

```ts
// Wrong：只有 parse 在 try 外，抛错时 #dispatchDesktopRequest 只记诊断，Desktop 等到超时
try { state = await this.#read(); } catch { return rpcError... }
return { result: localUsageQueryResultSchema.parse(buildLocalUsageView(...)) };

// Correct：整个 handler 体在 try 中，所有失败都返回 { error: { code: -32082 } }
```

```ts
// Wrong：每次查询都等价格加载，价格过期时 raw.githubusercontent.com 挂起会让打开页面卡 10 秒
const [state, price] = await Promise.all([readState, this.#loadPrices()]);

// Correct：只有第一次等待；过期后先用旧价格回答，后台刷新
if (!this.#prices) return this.#loadPrices();
if (this.#now() >= this.#prices.refreshAfter) void this.#loadPrices();
return this.#prices.price;
```

```ts
// Wrong：最长包含名兜底考虑所有键，LiteLLM 的空前缀名与 `fast` 之类把 `opus`、`<synthetic>` 计上价格
sortedNames.find((name) => model.includes(name));

// Correct：只考虑足够具体的名称（≥ 5 字符，含字母和数字），并跳过空的去前缀名
[...names.keys()].filter(isSpecificName)
```

```ts
// Wrong：只按「五项都不小于上次」判断是否差分；累计值重启到更大的值时算出的是两段累计值之差（真实数据中少计）
if (previous && USAGE_FIELDS.every((f) => total[f] >= previous[f])) return diff(total, previous);

// Correct：total 等于本次 last 说明累计值已重启，按 last 计入；累计值不变时为 0
if (previous && signature(total) === signature(previous)) return ZERO;
if (previous && signature(total) !== signature(last) && everyNotLess) return diff(total, previous);
return last ?? total;
```

## 新增一个 Harness 来源

1. 在该 Adapter 内实现 `nativeUsage.read`，文件位置与格式细节只放在 Adapter（ADR-0002）；Host 不改。
2. 游标带 `formatVersion`，用 schema `safeParse`，失败按 `null` 处理。
3. 只交出终值；`dedupeKey` 要在复制、重读时稳定。
4. 对话数按该 Harness 的口径（领域术语表 Conversation Count），在产品文档写明。
5. 推理只在单独上报时填 `reasoning`，已含在 `output` 中的不要再填；`reportedCostUsd` 只在 Harness 真正算出费用时填写（订阅通道记 0 可以，未知不能记 0）。模型名保持原样，计价匹配由 Host 负责；匹配不到时优先加 `MODEL_ALIASES`，只有 LiteLLM 没有该模型时才加 `MODEL_PRICE_OVERRIDES`。
