# Local Usage：原生用量读取与用量查询

产品行为见 `docs/product/local-usage.md`，决策见 `docs/adr/0001-*`、`0002-*`。本文是跨 Adapter → Host → Renderer 的可执行契约。

## 1. Scope / Trigger

- 修改 `HarnessAdapter.nativeUsage`、`LOCAL_USAGE_QUERY_METHOD` 的参数/结果、`host-runtime/src/local-usage-*.ts`、Renderer 用量页，或新增一个 Harness 的原生用量读取时阅读。
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
  conversations: number; reportedCostUsd?: number;
}

// host-runtime
class LocalUsageService {                        // local-usage-service.ts
  constructor(input: { adapters: ReadonlyMap<string, HarnessAdapter>;
    descriptors(): readonly HarnessPluginDescriptor[]; directory: string;
    diagnose(error: unknown): void; now?(): number });
  handle(request: JsonRpcRequest): Promise<JsonObject>;   // { result } | { error }
}
applyNativeUsageBatch(state, harnessId, batch): void      // local-usage-store.ts，先校验后修改
buildLocalUsageView({ buckets, period, timeZone, now, harnessName }): LocalUsageQueryResult // local-usage-view.ts，纯函数
defaultLocalUsageDirectory(env) // ${CODEXHOST_DATA_DIR:-~/.codexhost}/usage

// app-server-host.ts 只有一行分派 + #handleLocalUsage（waitForPlugins → service.handle → rpcEnvelope）
// Renderer：RendererModelClient.queryLocalUsage?(params)；设置页 createUsageSettingsPage(messages, getClient)
```

## 3. Contracts

- 记录**不带 Harness 字段**：Host 用 adapters Map 的键归属记录，Adapter 无法冒充其他 Harness。
- `cursor` 对 Host 不透明，Host 原样持久化；Adapter 不保存读取状态。无法识别的游标 = 从头读。允许重复返回已读记录，Host 按 `dedupeKey` 每个 Harness 只计一次（先到先得）。因此 Adapter **只能交出终值**：可能仍在增长的记录（例如流式中的回复）要等到终值再交出，把游标退回到它的第一行。
- 请求 `codexhost/usage/query`：`{ period: {kind:"day"|"week"|"month"|"total"} | {kind:"custom", from, to}, timeZone: IANA, refresh: boolean }`，全部 strict。日期 `YYYY-MM-DD` 且是真实日历日；自定义 `from ≤ to`，跨度 < 3660 天。
- 结果（strict）：`range{from,to}`、`totals{total,input,cacheRead,cacheWrite,output,reasoning,conversations}`（refine：`total` = 五项之和）、`models`、`harnesses[{harnessId,name,totalTokens,models}]`（按用量降序，只含 Token > 0 的 Harness）、`daily[{date,total,input,output,cacheRead,reasoning,conversations}]`（有 Token 或对话的日期，倒序）、`stats{last7Days,last30Days,dailyAverage,activeDays,firstActiveDate}`。不含正文、会话 ID、工作目录。
- `stats`（统计块，与所选周期无关，由 `local-usage-view.ts#usageStats` 从**全部**桶按请求时区归日后计算）：活跃日 = 当天 Token > 0 且不晚于今天（只有对话的日期、时钟偏差产生的未来日期都不算）；`last7Days`/`last30Days` = 今天往前 7/30 个日历日（含今天）的 Token 总数；`dailyAverage` = `Math.round(last30Days ÷ 其中活跃日数)`，无活跃日为 0；`activeDays`/`firstActiveDate` 覆盖全部已统计历史，不受「总计」24 个月限制，无历史时 `0`/`null`。schema `superRefine`：`firstActiveDate === null` ⇔ `activeDays === 0`；`last7Days ≤ last30Days`。统计块「对话数」不在 `stats` 中，Renderer 用 `totals.conversations`（所选范围之和）。
- 周期：周一为周首；`month` 为整月；`total` = 23 个月前当月 1 日到今天；日期由 Host 用请求的 `timeZone` 计算（`now` 为 Host 时钟）。
- 持久化：`<directory>/local-usage.json`，`{ formatVersion: 1, sources: {[harnessId]: {cursor, counted: string[]}}, buckets: [...] }`，`counted` 是 `sha256(dedupeKey)` 的 base64url 前 16 位；桶 = UTC 半小时起点 × harnessId × provider × model × cwd。临时文件 + rename 原子写入，目录 0700、文件 0600。
- `refresh:true` 读取新增记录；`refresh:false` 若有进行中的读取则等待它，否则用内存状态，再否则用磁盘状态，都没有才读取。并发读取共享同一个 Promise；每次读取先从磁盘加载，采纳其他 Host 进程的进度。
- Renderer 用量页始终用本地 Host（`modelClientForHost("local")`），打开时 `refresh:true`，切换周期/应用自定义 `refresh:false`，刷新按钮 `refresh:true`。

## 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| params 不合 schema（未知时区、非法日期、倒序或过长区间、多余字段、缺 `refresh`） | `-32602`，不触发读取 |
| 某 Harness `read` 返回 `ok:false` 或抛出 | 该 Harness 保留旧游标与桶，`diagnose`，其余 Harness 照常 |
| 某批记录不合 strict schema（负数、多余字段如正文） | 整批丢弃，同上 |
| 状态文件不存在 | 从头读取 |
| 状态文件损坏 | `diagnose` 后从原生记录重建 |
| `stats` 违反不变量（有活跃日却无开始日期、7 天 > 30 天） | 结果 schema 失败，按下一行处理 |
| 状态文件读/写 IO 失败、结果 schema 或 view 构建抛错 | `-32082 "Local usage could not be read"`（handler 在 try 中覆盖所有分支，必须回复 Desktop） |
| Renderer 收到 `RendererMethodUnavailableError` | 显示「不支持」，而非「失败」 |

## 5. Good / Base / Bad Cases

- Good：UTC 周日 23:30 的回复在 `Asia/Shanghai` 算周一，在 `UTC` 算上周。
- Base：追加一条回复后 `refresh:true`，总数只增加新记录；被 fork/resume 复制到另一文件的旧行不重复计；重启（新 service 实例）后结果一致。
- Good（统计块）：今天 03-04（Shanghai），02-26 00:00 本地的记录计入 7 天，02-25 23:59 的不计；02-03 计入 30 天，02-02 不计；2024 年的记录不在「总计」里，但决定 `firstActiveDate`。
- Base（统计块）：本机无记录 → `stats` 全 0、`firstActiveDate: null`，Renderer 不画统计块；只有一天 → 7 天 = 30 天 = 日均 = 该天总量、`activeDays: 1`。
- Bad：Adapter 在回复仍流式时交出部分用量，Host 先到先得，最终用量被当作重复丢弃（少计）。

## 6. Tests Required

- `host-runtime/test/local-usage.test.ts`（主切入点，真实 `ClaudeCodeAdapter` + 临时目录 + `handle()`）：各周期 `range`、时区归日、totals 精确值、`harnesses` 与 `daily`；`stats` 的 7/30 天本地日边界、日均分母、只有对话的日期与未来日期不计、`firstActiveDate` 早于「总计」范围、`stats` 不随周期变化，以及无数据与仅一天两个边界；增量 + 复制去重 + 重启一致；并发共享一次 `read`；读取中 `refresh:false` 得到刷新后的值；不合规批次被隔离；view 失败返回 `-32082`；非法 params `-32602` 且未读取。
- 各 Adapter 的解析测试（例如 `claude-native-usage.test.ts`）：重复行去重、增量只读完整行、流式等待、记录不含正文。
- `shared-contracts/test/local-usage.test.ts`：params/结果 schema 边界、`total` refine、`stats` 的两条 `superRefine` 与非整数/非法日期/多余字段。
- Renderer：`usage-dashboard.test.ts`（假 DOM 结构与格式化；统计块顺序、卡片与明细之间的位置、范围为空时仍显示、无历史时省略）、`usage-page.test.ts`（请求参数与刷新语义）、`renderer-model-client.test.ts`（方法与结果校验）、`tests/e2e/renderer-settings-usage.spec.ts`（放大尺寸、深浅色、窄窗口无横向溢出，本地运行）。

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

## 新增一个 Harness 来源

1. 在该 Adapter 内实现 `nativeUsage.read`，文件位置与格式细节只放在 Adapter（ADR-0002）；Host 不改。
2. 游标带 `formatVersion`，用 schema `safeParse`，失败按 `null` 处理。
3. 只交出终值；`dedupeKey` 要在复制、重读时稳定。
4. 对话数按该 Harness 的口径（领域术语表 Conversation Count），在产品文档写明。
