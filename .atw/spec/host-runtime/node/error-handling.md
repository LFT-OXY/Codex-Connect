# 错误处理与 JSON-RPC 错误映射

通用的三种错误形态见 `guides/typescript-workspace.md`。本包的特殊之处是：Host 直接对 Desktop 写 JSON-RPC 错误，错误码是**字面量**，分散在各处，没有集中的常量表。

## 写错误的方式

- 统一用 `app-server-host.ts` 中的 `rpcError(request, code, message)`，经 `this.#writer.json(...)` 写出。不要手写 `{ id, error }` 信封。
- 进程内诊断统一走 `#diagnose(error)`，写入 `diagnosticOutput`，前缀是 `codexhost Host Runtime:`。生产代码不用 `console.*`。
- 通过 `#dispatchDesktopRequest` 派发的任务出现未捕获异常时只会被 `#diagnose` 记录，**不会自动回复 Desktop**。所以每个 handler 必须自己在所有失败分支写出 `rpcError`，否则 Desktop 会一直等到超时。

## 现有错误码语义（新代码复用，不要另起新码）

| 码 | 含义 | 典型出处 |
|---|---|---|
| `-32602` | 参数非法（schema `safeParse` 失败，或 `protocol-core` 解码函数抛出异常） | 各 handler；`ExternalHistoryRequestError` |
| `-32001` | 官方请求发送失败或连接已退役，"retry explicitly"（Host 不自动重试） | `#forwardOfficialRequest`、`codex-runtime/official-runtime-owner.ts` |
| `-32070` | `thread/start` 时目标外部 Harness 未加载 | `#startExternalThread` |
| `-32072` | 外部 Thread 已有活动 Turn 或操作（`sessionBusy`） | 命令、steer、turn/start |
| `-32073` | 外部 Thread 已不可用，或 Harness 命令执行失败 | `ExternalCommandError`、turn 启动 |
| `-32074` | 调整方向（steer）的替换失败或被中止 | `ExternalSteerError` |
| `-32075` | 空闲释放导致 Session 暂不可用，或关闭失败 | `external-thread-runtime.ts`、`#deleteExternalThread` |
| `-32076` | 外部 Harness 不支持该操作，或原生失败（`unsupported`、`nativeFailure` 等） | 未知 `thread/*` 方法、历史投影失败 |
| `-32077` | Harness 不可用（`notInstalled`、`unavailable`、`authenticationRequired`），或 inspect 失败 | inspect、账号、命令目录 |
| `-32078` | 外部 Thread 不支持的元数据/命令操作，或命令目录非法 | `thread/metadata/update`、命令 |
| `-32079` | Native Session 已不存在（`sessionNotFound`） | 恢复、归档 |
| `-32080` | Fork Checkpoint 或回滚边界不可用 | Fork/Rollback/Revert |
| `-32081` | Mapping Store 持久化或读取失败 | Fork、归档、ownership list |
| `-32082` | 列表聚合、会话候选或 Local Usage 读取失败 | `thread/list`、会话导入、`codexhost/usage/query` |
| `-32086` / `-32087` | Codex 账号操作失败 / `initialize` 失败 | 账号、初始化 |
| `-32090` / `-32091` | 更新功能不可用 / 更新操作失败（message 截断到 500 字符） | `#handleUpdateRequest` |
| `-32092` | Harness Web UI 不可用或无法打开 | `#openHarnessWebUi` |

Renderer 会依赖其中一部分码，例如 `renderer-extension/src/renderer-session-import-client.ts` 把 `-32601` 和 `-32076` 视为"导入不可用"。**修改已有码的语义之前，先 grep `renderer-extension/src`。**

## HarnessError → RPC

- 统一使用 `protocol-core` 的 `mapExternalThreadHarnessError(error, operation)`，它把 `HarnessError.code` 映射到上表中的码，message 是固定文本，不包含原生错误正文。不要在 host-runtime 里另写一套 switch。
- 需要带 RPC 码跨层抛出时，使用具名错误类，并在 handler 边界用 `instanceof` 转换：`ExternalCommandError`（带 `code`）、`ExternalSteerError`、`ExternalHistoryRequestError`（固定映射到 `-32602`）、`ExternalThreadOpenError`（`external-thread-runtime.ts` 内部使用，携带 `ExternalThreadRpcError`）。
- 委派控制面走另一套协议：`DelegationControlError` 的字符串码（`INVALID_ARGUMENT`、`THREAD_BUSY`……）由 `delegation-control-server.ts` 的 `errorBody` 序列化成 HTTP JSON，不使用 JSON-RPC 数字码。

## 失败时关闭（fail-closed），不伪造成功

- Approval：投影失败（`projectApproval` 抛出异常）时立即拒绝原生请求；只有唯一 deny 动作时才发送 deny，否则 `turn.cancel`。Desktop 返回 `error`，或回复无法解析时，按 `denyResponse` 处理；`interaction.respond` 失败时取消 Turn（`#handleDesktopApprovalResponse`）。
- 外部 Thread 上未显式处理的 `thread/*` 方法返回 `-32076`（`EXPLICIT_EXTERNAL_THREAD_METHODS` 之外的分支），**不透传给官方 app-server**，也不回退到 Codex。
- 非法或未安装的插件路由直接报错，不交给官方 app-server。
- 官方请求失败返回 `-32001`，由用户或客户端显式重试。Host 不自动重试，以免掩盖传输失败（`docs/architecture/app-server-transport.md`）。
- 插件诊断和 Harness 账号查询不透传原生异常正文或凭据（见 [plugin-loading.md](./plugin-loading.md)）。

## 已知不一致（照实记录）

- 有几处会把 `errorMessage(error)` 直接拼进返回给 Desktop 的 message，例如 `Harness inspection failed: ${errorMessage(error)}`、`External Harness command failed: ...`、`-32087`。新代码应优先使用固定文本；确实需要附带原生诊断时，先经过 `sanitizeDiagnosticTail`。
