# Local Sessions：会话摘要、会话查询与恢复

产品行为见 `docs/product/sessions.md`，恢复底层的会话导入事务见 `docs/architecture/harness-session-import.md`。会话与 Local Usage 共用同一次原生记录读取、同一个状态文件，读取、游标、计价规则见 [local-usage.md](./local-usage.md)。本文是跨 Adapter → Host → Renderer 的可执行契约。

## 1. Scope / Trigger

- 修改 `HarnessNativeSessionSummary`、`HarnessNativeUsageCapability.resumeCommand`、`NativeSessionActivity` 辅助函数、`LOCAL_SESSIONS_QUERY_METHOD`（`codexhost/sessions/query`）的参数/结果、`host-runtime/src/local-sessions-view.ts`、`local-session-candidates.ts`、`LocalUsageService.handleSessions`、各 Adapter 读取器的会话摘要，或 Renderer「会话」页（`settings/sessions-*.ts`、`session-resume-command.ts`）时阅读。
- 跨层：Adapter 摘要 → Host 校验、按 key 替换、按会话计价与折叠 → shared-contracts `localSessionSchema` → Renderer 筛选、渲染、恢复。任一层改字段都要同步其余三层。

## 2. Signatures

```ts
// harness-adapter/src/text-session.ts
interface HarnessNativeUsageBatch {
  records: readonly HarnessNativeUsageRecord[];
  sessions?: readonly HarnessNativeSessionSummary[];  // 本次有变化的摘要；不支持时省略
  cursor: JsonValue;
}
interface HarnessNativeSessionSummary {
  key: string;               // 被摘要的记录单元（通常一个文件）；同 key 的新摘要整体替换旧摘要
  nativeSessionId: string;
  parentSessionId?: string;  // 子代理/子会话：用量与计数折叠进该会话
  title?: string; cwd?: string; model?: string /* 最后使用的模型 */;
  firstActivityAt: number; lastActivityAt: number;  // epoch ms
  activeMs: number;          // 相邻带时间戳记录的间隔之和，间隔 > 30 分钟不计
  turns: number;             // 该 Harness 口径的用户回合数
  edits: number;             // 至少调用过一次编辑类工具的回合数（含未结束的当前回合）
}
interface HarnessNativeUsageCapability {
  read(cursor, onProgress?): Promise<HarnessResult<HarnessNativeUsageBatch>>;
  resumeCommand?(nativeSessionId: string): string;  // 例 `claude --resume <id>`，在会话 cwd 运行
}

// harness-adapter/src/native-session-summary.ts（游标里可 JSON 序列化的累积状态）
type NativeSessionActivity = { firstActivityAt: number | null; lastActivityAt: number | null;
  activeMs: number; turns: number; edits: number; editing: boolean };
emptyNativeSessionActivity(); parseNativeSessionActivity(value: unknown): NativeSessionActivity | null;
recordNativeSessionActivity(activity, time);  // 乱序时间只扩展首尾，不加活跃时长
startNativeSessionTurn(activity);             // 先结算上一回合的 editing
recordNativeSessionEdit(activity);            // 哪些工具算编辑由各 Adapter 自己决定
nativeSessionEdits(activity): number;         // edits + (editing ? 1 : 0)

// host-runtime
LocalUsageService.handleSessions(request): Promise<JsonObject>;   // local-usage-service.ts
localSessionMappings(records: StoredThreadRecordV1[]): LocalSessionMapping[];  // 复用 ownedNativeSessionRef
ownedNativeSessionRef(record): NativeSessionRef | null;            // harness-session-import.ts
listLocalSessionCandidates(adapters, diagnose): Promise<{ candidates; failed }>; // local-session-candidates.ts
buildLocalSessionsView({ summaries, usage, price, harnessName, project, threadId, resumable,
  resumeCommand, candidates, failedHarnessIds }): LocalSessionsView; // local-sessions-view.ts，纯函数

// renderer-extension
sessionResumeCommand({ resumeCommand, cwd }, "posix" | "powershell"): string | null;
filterSessions(sessions, { harnessId, range: "all"|"7"|"30"|"90", project, query }, now): LocalSession[];
```

## 3. Contracts

- 请求 `codexhost/sessions/query` `{ refresh: boolean }`（strict）。结果 = `localUsageReadingSchema`（`{status:"reading", progress}`）| `localSessionsViewSchema`：`{ status:"ready", sessions: LocalSession[] (≤ 100 000，按 lastActivityAt 降序、ID 次序), harnesses: [{harnessId, name}]（有行的 Harness，按 name 排序）, failures: [{harnessId, name}] }`。
- `LocalSession`：`harnessId`（`"codex"` 或插件 ID）、`nativeSessionId`、`title | null`、`cwd | null`、`project | null`（`owner/repo` 或文件夹名）、`model | null`、`startedAt | null`、`lastActivityAt`、`activeMs | null`、`usage: {totalTokens, estimatedCostUsd} | null`、`turns | null`、`edits | null`、`subagents`、`threadId | null`、`resumable`、`running: boolean | null`、`resumeCommand: string | null`（≤ 256，`LOCAL_SESSIONS_RESUME_COMMAND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:=/-]*$/`）。不含任何消息正文；标题只来自 Harness 自己的命名或与会话导入相同的标题提取。
- 状态文件（`usage/local-usage.json`，`formatVersion: 3`）：`sessions[]`（`harnessId × key` 一条摘要）、`sessionUsage[]`（`harnessId × nativeSessionId × provider × model × 是否自带费用`，六项 Token + 可选 `reportedCostUsd`）。`sources[h].sessionCounted?` 只在从 v2 迁移后存在（见 local-usage.md「持久化」）。
- 视图规则：同 `harnessId × nativeSessionId` 的多份摘要相加（turns/edits/activeMs 求和、首末取极值、title/model/cwd 取最后活动的非空值）；沿 `parentSessionId` 找根（父不存在或成环则自成根）；根行的 Token 与费用含整棵树，`turns`/`edits`/`activeMs` 只算根自身，`lastActivityAt` 取整棵树最大值，`subagents` = 树中非根节点数；整棵树 Token 为 0 的根不列出。费用按每条 `sessionUsage` 在查询时计价（`reportedCostUsd ?? usageCostUsd(price(model))`，model 为 null 记 0）。
- `threadId`：官方 Codex 行 = `hostThreadIdSchema.safeParse(nativeSessionId)`（Codex Thread 与会话同 ID，不映射）；其余 = 映射库中 `ownedNativeSessionRef` 匹配的 Thread。`resumable` = 官方 Codex 或 Adapter 实现了 `sessionImport.resolveCandidate`。
- `resumeCommand`：Host 取 `adapter.nativeUsage.resumeCommand`（官方 Codex 取 `officialCodexUsage.resumeCommand`），仅当 `nativeSessionId` 匹配 `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/` 且返回值通过长度与 PATTERN 时提供；抛错 → `diagnose` 后 null。
- 导入候选：只对**没有 `nativeUsage`** 且实现 `sessionImport.resolveCandidate` 的 Adapter（Hermes、DSH）列举；`refresh:true` 时重新列举，`refresh:false` 复用上次的 Promise；按 `harnessId × nativeSessionId` 与已有行去重后作为空用量行（`usage/turns/edits/activeMs/startedAt/model = null`，`running` 取候选）。
- Renderer：始终用本地 Host；打开 `refresh:true`，刷新按钮 `refresh:true`，`reading` 时每 500 ms `refresh:false` 重查——没有已显示的视图才画进度，已有列表时只保持按钮「读取中」。恢复：`threadId ?? importHarnessSession(...)`（`harnessPluginIdSchema` 解析失败按「不支持」处理）后 `openThread`；复制指令 = `sessionResumeCommand`。

## 4. Validation & Error Matrix

| 条件 | 结果 |
|---|---|
| 参数不是 `{refresh: boolean}` | `-32602 Invalid local sessions query params` |
| 摘要字段不合 schema（缺字段、负数、多余字段、title > 4096） | 整批按不合规处理：该 Harness 进入 `failures`，状态与游标不变 |
| 单个 Harness 读取失败 | 该 Harness 进 `failures`，其摘要与用量保持上次成功读取的值 |
| 候选 `listCandidates` 失败、> 5 s（`CANDIDATE_LIST_TIMEOUT_MS`）、不合 schema 或含重复 ID | 该 Harness 进 `failures`，其余照常；不阻塞列表 |
| 读取 0.5 s 内未完成 | `{status:"reading", progress}`（经 `localUsageReadingSchema` 校验） |
| 映射库读取失败 / 视图 schema 失败 | `-32082 Local usage could not be read`，`diagnose` |
| 会话 ID 不在安全字符集 / 命令不合 PATTERN / 没有 `resumeCommand` | 该行 `resumeCommand: null`（不提供复制指令） |
| Renderer 恢复：导入返回 `-32079` / `-32072` / 不支持（`-32601`、`-32076`、Codex 之外无映射又无法导入） | 恢复面板显示「已不在本机」/「正在其他地方运行」/「不支持」，附项目路径、复制与重试 |
| 映射已建立但 `openThread` 失败（侧栏未出现该 Thread） | 面板显示打开失败，重试只打开同一 Thread，不再导入 |

## 5. Good / Base / Bad Cases

- Good：Claude 主会话 + `subagents/agent-a1.jsonl`，一行，Token 含子代理，`subagents: 1`，`turns` 只算主会话；官方 Codex 子线程（`forked_from_id`）折叠进主线程，行的 `threadId` = 会话 ID。
- Base：Hermes 候选并入为空用量行；Pi/oh-my-pi 的 Fork（`parentSession` 是文件路径）单独成行；从未产生 Token 的会话不列出。
- Bad：Adapter 把消息正文放进 title 以外的字段（schema 拒绝整批）；Adapter 每次只报增量 turns（摘要是整体替换，增量会让数字倒退）；Renderer 写 `harnessId === "codex"` 或自己拼 CLI 命令（Harness 语义泄漏）。

## 6. Tests Required

- `host-runtime/test/local-sessions.test.ts`（请求层，真实 Adapter + 临时目录）：行字段全等（含 `resumeCommand`）、不含 SECRET、子代理折叠与用量归并、活跃时长 30 分钟规则、轮数排除工具结果/meta/`[Request interrupted by user…`、恢复复用导入且不重复映射、增量追加、官方 Codex（`threadId` = ID、子线程折叠、`codex resume`）、Pi/oh-my-pi 列出与经导入恢复、Hermes 候选并入与 DSH 列举失败隔离、轮询复用候选、候选超时（假定时器）、不安全 ID 无命令、v2 迁移（历史桶保留、会话用量不为 0 也不翻倍、追上后共用一套键）、单来源失败。
- 各读取器测试：Claude/Codex/Pi/oh-my-pi 的摘要字段、游标续算（流式重读不重复计轮数、重命名/标题槽改写重新产出、归档保持 key、替换文件重置）、父子识别（Fork 不作父）、`resumeCommand`。
- `shared-contracts/test/local-sessions.test.ts`：多余字段、负数、空白 ID、含 `;`/`$(` 的命令被拒。
- `renderer-extension/test/settings/sessions-page.test.ts`、`session-resume-command.test.ts`：行结构与空用量、恢复/失败面板/重试、筛选组合与汇总文案、分批渲染、刷新时保留列表、POSIX/PowerShell 转义与无命令时不提供。

## 7. Wrong vs Correct

```ts
// Wrong：Renderer 按 Harness 拼命令，Host/Adapter 之外的层知道 CLI 语法
const RESUME = { "claude-code": (id) => `claude --resume ${id}` };

// Correct：Adapter 提供命令，Host 校验后放进行里，Renderer 只给项目路径加引号
readonly nativeUsage = { read, resumeCommand: (id: string) => `claude --resume ${id}` };
sessionResumeCommand({ resumeCommand: session.resumeCommand, cwd: session.cwd }, shell);
```

```ts
// Wrong：迁移旧状态时复用 counted 判断会话用量——旧记录都已计入桶，会话用量永远为 0
if (counted.has(key)) continue; // 同时跳过了 sessionUsage

// Correct：v2 迁移给来源一套空的 sessionCounted，桶与会话用量各自去重，追上后按同一集合
const sessionCounted = source?.sessionCounted ? new Set(source.sessionCounted) : counted;
```

## 新增一个 Harness 的会话

1. 在该 Adapter 的 `nativeUsage.read` 里按文件（或其他稳定单元）累积 `NativeSessionActivity`，放进游标续算；只在该单元有新内容（或标题等元数据变化）时产出摘要，每份摘要覆盖该单元的全部记录。
2. 已读但为了等待流式结果而重读的行不能再计入摘要（Claude 用 `summarized` 偏移隔开）。
3. 编辑类工具名、父子关系来源、标题来源都在 Adapter 内决定；`nativeSessionId` 要与该 Harness 会话导入/恢复用的 ID 一致。
4. 能在自己的 CLI 中按 ID 恢复时实现 `resumeCommand`；命令只能是程序名、参数和 ID。
5. 在 `docs/product/sessions.md`「口径」写明标题、轮数、编辑数、父子关系的口径。
