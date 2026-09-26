# 07 — 项目用量、首次读取进度与失败隔离

**What to build:** 用量页新增「项目用量」标签，按项目列出用量；首次读取全部历史时显示进度；某个 Harness 读取失败时只有它显示失败提示，其他正常。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

## Acceptance criteria

- [x] 项目识别：由工作目录向上查找 Git 远程并规范为 owner/repo，没有远程时用文件夹名；按目录缓存
- [x] 读取未完成时查询返回进度，Renderer 定时重查直至完成；关闭设置后停止
- [x] 单来源失败隔离并在结果中带出失败状态
- [x] Host 请求层测试覆盖项目分组、进度与失败隔离
- [x] 人工验证：用本机全部真实记录，与 TokenTracker 对比同一时段总数、占比与费用，差异能解释；记录首次读取实际耗时
- [x] 产品文档同步更新

## Implementation notes

- 契约：`codexhost/usage/query` 结果改为按 `status` 区分的联合——`{status:"reading", progress:{processed,total}}` 或 `{status:"ready", …, projects, failures}`；公共 Adapter 契约 `nativeUsage.read(cursor, onProgress?)` 新增可选进度回调（旧插件不受影响）。四个读取器（Claude Code、Pi、oh-my-pi、官方 Codex）都按文件报告进度。细节见 `.atw/spec/host-runtime/node/local-usage.md`。
- 进度：查询最多等读取 500 ms，超时返回 `reading`；Renderer 每 500 ms 以 `refresh:false` 重查（只等待同一次读取），关闭设置（页面 signal abort）即停。PRD 原写「不刷新的查询遇到进行中的读取时等待它完成」，现为最多等 500 ms。读取在查询不再等待后整体失败时，下一次轮询报告该错误而不是重新读取（避免首次读取反复失败时永远只见进度）。
- 项目：`host-runtime/src/local-usage-projects.ts`。远程地址取主机之后路径的**最后两段**（`owner/repo`）；审查指出自建服务器 `host:/srv/git/repo.git` 若取全路径会变成 `srv/git/repo`，因此 GitLab 多级分组 `group/sub/repo` 也显示为 `sub/repo`（与 TokenTracker 保留整段不同）。linked worktree 没有远程时用主仓库文件夹名；`cwd` 为空串的记录不进项目；解析缺失时不回退到原始路径。`~` 本身是 Git 仓库（dotfiles）时其下的临时文件夹会归入该仓库——这是 Git 的归属语义，未特殊处理。
- 失败：最近一次完成的读取中失败或记录不合规的来源进入 `failures`（仅内存），页面顶部逐个提示，其卡片与项目仍显示上次统计。
- 页面：统计块下方「每日明细 | 项目用量」两个标签（照 TokenTracker），切换周期或刷新后保持；标签照 `connections-page.ts` 支持方向键与 roving tabIndex。

## 人工验证（2026-09-26，本机全部真实记录）

- 首次全量读取：约 2,210 个文件、2.6 GB，两次分别 4.5 s、5.2 s，期间返回 4 次进度（如 `258/1424` → `1958/2210`，总数随各来源列完文件增长）；之后增量约 0.26～0.27 s。
- 与 TokenTracker（本机 `localhost:7680` 本地 API 与 `~/.tokentracker/tracker/*.jsonl`）对比 2026-09-19～25（Asia/Shanghai）：
  - Token 总数 3,197,385,640 vs 3,195,006,760（+0.07%）。Pi 617,878,063、Codex 1,446,143 两边逐项相同；Claude Code 的输入、缓存读、缓存写与对话数（1,393）相同，只有输出多 2,378,880：TokenTracker 按 `msgId+reqId` **先到先得**，取的是同一回复的第一行（输出常未到终值），本实现取最后一行的最终用量（issue 01 规则）。
  - 占比：Claude Code 80.63% / Pi 19.32% / Codex 0.05%，与 TokenTracker 一致到小数点后两位（差异同上）。
  - 费用 $2,541.10 vs $2,732.01：差额主要来自 `claude-opus-5-5`（$248.85 vs $436.96）。TokenTracker 的手工覆盖表总是优先且按前缀匹配，`match: "claude-opus-5"` 把 `claude-opus-5-5` 按 Opus 5 价（$5/$25、缓存读 $0.5）计；本实现用 LiteLLM 精确条目（$4/$20、缓存读 $0.2）。Token 数一致，差异只在价格表。
  - 项目：TokenTracker 只把约 2,275M / 2,575M 的 Claude Code 用量归到项目（只列有 Git 远程的项目），本实现把所有带工作目录的用量都归项目，因此如 `LFT-OXY/Osuna` 为 1.753B vs 1.622B。TokenTracker 未归项目的具体是哪些记录未核实。
- 自动化：全量 TypeScript 测试中只有 `claude-code/test/command.test.ts`、`opencode/test/command.test.ts` 各 1 例失败（受本机已安装的 CLI 影响，与 06 记录相同，与本工单无关）；e2e `tests/e2e/renderer-settings-usage.spec.ts` 用本机 Chrome（`CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH`）运行通过。

## 后续调整（2026-09-26，用户验收后）

- 取消「用量」页放大尺寸：放大后盖住 macOS 红绿灯（Codex Desktop 的 `env(titlebar-area-height)` 为 0），且与其他设置页不一致。删除 issue 01 加入的 `RendererSettingsPageDefinition.size`/`data-size` 机制与对应 CSS，页面与其他设置页同尺寸。
- 缓存写两档计价：用户对比 TokenTracker 时发现费用差距。差距主体是 TokenTracker 把 `claude-opus-5-5` 前缀匹配到 Opus 5 价格（官方价格页确认 Opus 5.5 为 $4/$20、5 分钟写 $5、1 小时写 $8、缓存读 $0.20，本实现正确）；同时发现本实现把 1 小时缓存写都按 5 分钟价计而偏低。记录契约新增可选 `tokens.cacheWrite1h`（`cacheWrite` 的子集），Claude Code 从 `cache_creation.ephemeral_1h_input_tokens` 上报；价格取 LiteLLM `cache_creation_input_token_cost_above_1hr`（缺失时同 5 分钟价）；用量状态与价格缓存都升到 `formatVersion: 2`，旧文件重建/重新拉取；内置价格快照已重新生成。本机 2026-09-26 的 `claude-opus-5-5`：1,915 万缓存写中 666 万为 1 小时档，费用 $399.54 → $419.52；2026-09-19～25 合计 $2,541.10 → $2,640.72。

