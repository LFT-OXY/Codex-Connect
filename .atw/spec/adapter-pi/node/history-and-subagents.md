# Pi 历史、Fork/回滚与子代理

## 历史映射（`pi-history.ts`）

- 数据来源是 RPC `get_entries`，返回 `{ entries, leafId }`。Pi 会话是一棵 entry 树，`activePiEntries()` 从 `leafId` 沿 `parentId` 回溯出当前分支。出现环或引用缺失 entry 直接抛错，不做容错。
- Turn 切分：每条 `role: "user"` 的 message entry 开启一个 Turn，一直到下一条 user entry 为止。`model_change` entry 更新之后 Turn 的有效 Model。
- 身份：`nativeTurnKey` 和 `checkpointId` 都用该 Turn 的 **user entry id**；Item id 是 `pi-item-v1-<entryId>-<kind>-<ordinal>`。live 路径与 resume 路径必须产出相同的 key，否则 UI 会重复显示。

## Fork（`PiAdapter.open`，kind = `fork`）

1. 校验 checkpoint 的 `harnessId` 和 `nativeSessionId` 属于源 Session，否则返回 `checkpointNotFound`。
2. 用 `--fork <源文件>` 启动新进程，此时已得到一个不同 ID 的副本。
3. `resolvePiForkBoundary()` 在副本的活动分支上找到目标 user entry，以及它之后的**下一条** user entry。如果存在下一条，就调用原生 `fork(nextUserEntryId)`，截掉它及之后的内容。
4. 校验：派生 Session ID 不等于源 ID 和启动 ID；`mapPiSnapshot` 的 Turn 数等于 `targetTurnIndex + 1`，且最后一个 Turn 的 key 等于 checkpoint；最后 `verifySessionCwd()` 读取 Session 文件头，用 realpath 比较 cwd。
5. 能力声明为 `forkAcrossCwd: true`：Pi 的 `--fork` 允许把副本绑定到新 cwd，第 4 步的 cwd 校验确认实际绑定结果。

## 回滚上一轮（`pi-last-turn-rollback.ts`）

- 以源文件 `--fork` 启动后，调用原生 `fork(lastUserEntryId)`。之后恢复启动时的 Model/Thinking（原生 fork 可能改变它们），再校验保留的 Turn key 序列与源历史前缀完全一致。
- 回滚只替换会话历史，不回滚工作区文件。

## 空会话持久化（`pi-empty-session.ts`，Pi 特有的坑）

- Pi 对空 fork 会延迟写盘，直到第一条 Assistant 消息出现。回滚单轮会话后，`verifySessionCwd` 读 Session 文件会得到 `ENOENT`，此时返回 `{ ok: true, unpersisted: true }`。
- Adapter 的处理（见 `open()` 中的注释）：先 `close()` 当前写入进程；`persistEmptyPiSession()` 以 v3 格式写临时文件 → `fsync` → 用 `link()` 独占发布（目标已存在就失败，不覆盖原生写入者）→ fsync 目录；然后以 `--session` 冷恢复，并校验 ID、Model、Thinking、cwd。
- 只接受源文件头为 `version: 3` 的会话（注释：不要把未来版本当 v3 解读）。
- `readPiEmptySessionConfiguration()`：只有**线性、无 message** 的 v3 历史才会通过 `--provider/--model/--thinking` 注入启动配置。原因是 Pi 恢复空会话时会用全局默认值；有分支或非空的历史交给 Pi 自己恢复。resume 时每次都会调用它。

## 子代理（`pi-subagents` 插件，nicobailon）

Pi 核心没有子代理协议。本包只接入 `pi-subagents` 的两种形态，其他同名插件或没有身份摘要的同步单 Agent 调用都当普通工具处理。协议细节以 `docs/harnesses/pi/pi-subagents.md` 为准。

| 形态 | 实时来源 | 读取子会话 | ID 前缀 |
|---|---|---|---|
| 异步 | `extension_ui_request/setWidget` 中的 `PI_SUBAGENT_ASYNC_JSON:` 状态快照（`PiSubagentRpc`） | 先用 `get_commands` 确认存在 `subagents-inspect-rpc`，再发该命令；只接受请求/身份匹配的 `PI_SUBAGENT_INSPECT_JSON:` v1 回包，最多 200 条消息、64 KiB | `pi-subagents-v1:` |
| 同步 workflow | 工具增量和最终结果里的 `details.workflowChildren` v1 | 从父会话当前分支的工具结果中定位子 Session 文件，只读，最多 8 MiB；文件不可用时退回 `finalOutput` 摘要，并明确标注 | `pi-subagents-workflow-v1:` |

- 身份必须由 run ID 加原生 child ID 组成。`index` 可能都是 0，不能作为身份；`host-step` 不是 Agent，不生成子 Thread。
- `PiAdapter.subagents.readSnapshot` 优先复用内存中的父 Session；父 Session 不在内存时，以父 Session 文件临时启动一个 transport，校验 ID 和 cwd，读取完成后在 `finally` 中关闭。
- 原生错误码映射：`foreign_session` → `invalidRequest`，`not_found`/`stale` → `sessionNotFound`，其余为 `unavailable`。不要把这些错误降级成空的成功快照。
- 父历史恢复（`pi-subagent-history.ts`）：最多读最近 128 个 run 的 `status.json`，每个文件最多 1 MiB，打开时带 `O_NOFOLLOW`，只接受 lifecycle artifact v3，且 run ID、父 Session ID 必须精确匹配。快照里缺失的 run/child **不代表已结束**，保留已观察到的状态。
- 父 Turn 取消或父工具返回，都不能证明后台子任务已结束，不要伪造原生停止。
