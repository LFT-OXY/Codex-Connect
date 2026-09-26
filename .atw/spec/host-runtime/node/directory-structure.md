# 子域地图：改动放在哪里

`src/` 基本是平铺的，按文件名前缀区分子域。只有 `codex-runtime/`（官方 app-server 进程与连接）和 `account/`（Codex 账号）两个子目录。新文件沿用同样的前缀命名，不要为单个功能新建目录。

## 请求入口与分派

- `app-server-host.ts` 中的 `AppServerHost` 是**唯一**的 Desktop 连接对象，每个 Desktop/远程会话各一个实例。`#forwardDesktop` 读取 LF 帧：`initialize` 在读取循环内直接处理，其余请求经 `#dispatchDesktopRequest` → `DesktopRequestQueue.run(threadId)` → `idleRelease.runOperation(threadId)` → `#handleDesktopRequest` 进入分派。
- `#handleDesktopRequest`（约第 966–1540 行）是一长串 `if (request.method === …)`。新方法加在这里时只写一个分派分支，调用 `#xxx` 私有方法或独立模块，未匹配的请求最后落到 `#forwardOfficialRequest`。
- `desktop-request-queue.ts`：同一 Thread 的请求按收到顺序执行，不同 Thread 之间并行。失败的请求不能阻塞同 Thread 队列（注释 "must not poison the Thread's queue"）。关闭时要先停止接收新请求，再 `drain()`。

## 子域与文件对应

| 改动类型 | 放在 |
|---|---|
| 启动组合、进程模式、远程监听装配 | `run-host-runtime.ts`、`main.ts` / `release-main.ts` |
| 外部 Thread 打开/恢复/关闭、按名称的恢复策略 | `external-thread-runtime.ts`（`ExternalThreadRuntime`、`ExternalThreadResolution` 为 `official \| external \| error`） |
| Mapping Store 读写封装、Snapshot 对齐 | `external-thread-repository.ts`（`ExternalThreadStore` 接口，`defaultMappingStoreDirectory` = `${CODEXHOST_DATA_DIR:-~/.codexhost}/mapping-store`） |
| 历史分页 `thread/turns/list`、`thread/items/list` | `external-thread-history.ts` |
| Fork / Rollback / Revert | `external-thread-fork.ts`、`external-thread-rollback.ts`，协议解码在 `protocol-core/thread-fork.ts` |
| `thread/list` 合并官方与外部结果 | `thread-list-aggregator.ts` + `external-thread-list.ts` |
| 外部 Thread「调整方向」 | `external-turn-steering.ts`（设计见 `docs/architecture/external-thread-steering.md`） |
| 空闲会话释放 | `external-thread-idle-release.ts`（只做 Host 侧协调，不对原生后台工作作任何保证） |
| 原生 Subagent 物化为子 Thread | `external-subagent-threads.ts` |
| Harness 命令（`/xxx`） | `external-command-routing.ts`、`live-command-catalog-cache.ts` |
| 会话导入 | `harness-session-import.ts`（`HarnessSessionImporter`）、`session-import-requests.ts`（包括旧 DSH RPC 别名） |
| Local Usage（`codexhost/usage/query`） | `local-usage-service.ts`（请求、共享读取）、`local-usage-store.ts`（校验、去重、半小时桶、持久化）、`local-usage-view.ts`（纯函数：周期与时区归日、查询时计价）、`local-usage-pricing.ts`（纯函数：模型名匹配、费用公式、手工覆盖与别名表）、`local-usage-prices.ts`（价格来源回退与 `model-prices.json` 缓存）、`local-usage-price-snapshot.ts`（生成文件，由 `tools/update-model-price-snapshot.mjs` 刷新），见 [local-usage.md](./local-usage.md) |
| 插件加载与目录 | `harness-plugin-loader.ts`、`harness-plugin-registry.ts`、`plugin-files.ts`、`installed-harness-plugins.ts`，详见 [plugin-loading.md](./plugin-loading.md) |
| 插件级设置、账号额度 | `harness-launch-settings.ts`（每个插件一个文件）、`harness-accounts.ts` |
| 委派（Delegation） | `harness-delegation-coordinator.ts`，控制面是 `delegation-control-server.ts`（127.0.0.1 + Bearer token）和 `delegation-control-registry.ts`；CLI 是 `delegation-cli*.ts`；Skill 安装在 `delegation-skill.ts`（写到 `~/.agents` 和 `~/.claude`）；官方 Turn 的 `#` 提及改写在 `delegation-mention-rewrite.ts` |
| 官方 Codex 原生用量（rollout 读取） | `codex-runtime/codex-native-usage.ts`：官方 Codex 没有 Adapter，按 ADR-0002 放在 Codex 运行时目录，直接读 `CODEX_HOME` 下的 rollout 文件，不经过 app-server；由 `#handleLocalUsage` 以 `officialCodexUsage` 传给 `LocalUsageService`，见 [local-usage.md](./local-usage.md) |
| 官方 app-server 进程与连接 | `codex-runtime/`：`OfficialRuntimeScope`（每个 Host 部署一份，被多个 Desktop 会话共享）、`OfficialRuntimeOwner`（进程所有者）、`OfficialWorkGate`（准入）、`CodexRuntime`（可替换的协议连接）；根目录的 `official-*.ts` 是连接与进程生命周期的底层实现 |
| Codex 账号与额度 | `account/`、`native-account-*.ts`、`codex-runtime/account-rate-limits.ts`、`credential-imports.ts` |
| 远程 Host | `remote-app-server.ts`（Unix listener）、`remote-control-app-server.ts`（Windows 命名管道桥，`createRemoteControlAppServerPlan` 在非 win32 平台返回 null）、`remote-host-install.ts` / `remote-host-lifecycle.ts` / `remote-host-cli.ts`（SSH 安装与启停）、`remote-official-*.ts`、`remote-socket-lock.ts` |
| 应用更新 RPC | `update-coordinator.ts`，只编排 `@codexhost/update-manager`，见该包的 spec |
| macOS Aqua Broker 入口 | `aqua-harness-broker.ts`，目前只支持 Claude Code 语义 |

`desktop-control` 在 `src/` 中只有 `index.ts` 用来读取 `packageMetadata`，没有其他运行时调用。

## `app-server-host.ts` 技术债

- 约 4558 行，集中了分派、官方转发、委派、Approval/Question 投影和 Subagent 状态。这是历史状态，**不要继续往里堆新职责**。已有拆分方式可以参考：`external-thread-fork.ts` 导出 `executeExternalThreadFork`，由 Host 传入依赖后调用。
- 这里保留了一个按名称写的旧 `switch`：`approvalServerName(harnessId)`，覆盖 pi、claude-code、grok、kiro-cli 等。它只在插件描述缺失时兜底，优先使用的是 `this.#pluginDescriptors.find(...).name`。**新 Harness 不要往这个 `switch` 里加。**
- `defaultAgent: "codex" | "pi"`（环境变量 `CODEXHOST_DEFAULT_AGENT`）是早期遗留的固定取值，不能当作扩展点。

## 所有权原则（来自代码注释）

- 外部 Thread 只存元数据、Native Session 引用和 Turn 映射，**不建立第二份完整正文事实源**，历史从 Adapter 的 `readSnapshot` 读取（`docs/architecture/harness-plugin-runtime.md`）。
- 官方 app-server 失败不能连带关闭外部 Harness 或远程 listener（`run-host-runtime.ts` 的注释："Official failure/replacement must never close this listener or external Harnesses"）。
- 一个 `HarnessPluginRegistry` 只属于一个 Host 连接，不放在进程全局。
