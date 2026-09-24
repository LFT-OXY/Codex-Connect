# Hermes gateway 历史与派生

gateway 路径的历史**不走** gateway RPC。原因是原生 `session.branch(count)` 只复制显示文本，会丢失工具之间的关联（`hermes-capabilities.md`“精确 Fork 与修订上一条”）。改用 `HermesGatewayHistory`（`gateway-history.ts`）：每次操作启动一个独立的 Python 进程，执行内嵌脚本 `GATEWAY_HISTORY_SCRIPT`（`gateway-history-script.ts`），通过 Hermes 官方 `SessionDB` 与 export/import API 读写。

## 进程约束（`HermesGatewayHistory.#run`）

- 启动命令是 `<python> -I -u -c <script>`，使用 gateway 同一个 Python、cwd 和环境；请求 JSON 经 stdin 传入，结果 JSON 从 stdout 读出。
- 上限：超时 30 s；stdout 超过 32 MiB 就 kill 进程并报 “exceeds the supported size”。
- stderr 只 `resume()` 丢弃，**不读取、不外露**，因为原生异常可能包含对话或配置内容。退出码非 0 时统一报 “source history was not modified”。
- 脚本通过 `{ error: { code, message } }` 返回的 `unsupported`/`checkpointNotFound`/`invalidState` 会转成 `HermesGatewayHistoryError`，把错误码原样带给 Host；其他错误一律归为 `nativeFailure`。

## 操作

| operation | 用途 | 调用方 |
|---|---|---|
| `read` | 读取当前 lineage 的消息行、`derivable` 标志、每个 Turn 的 `boundaries`（前缀长度 + 消息摘要） | `readSnapshot()` → `projectGatewayHistory()` |
| `resolve` | 返回持久化的物理 Session ID | `openGatewaySession`：打开后与 live `stored_session_id` 核对，不一致就失败 |
| `ensure` | 新会话在 SessionDB 中落地（cwd、model、provider、reasoning） | create 路径 |
| `derive` | 按 checkpoint 或 `rollbackLastTurn` 导出源会话，只保留精确前缀，再以新 ID、`parent_session_id` 导入 | fork/rollback |
| `discard` | 删除本实例刚派生的会话 | 打开失败时的清理 |

## 派生规则（改动时必须保留）

- 只有满足 `derivable` 才允许派生：当前 ID 等于公开 ID、lineage 长度为 1、没有 `compacted`/`_compressed_summary` 行，且 `user_originated_turn_view` 的行序与活动行一致。压缩归档或 continuation 的历史**仍可查看，但派生返回 `unsupported`**，因为原生 import 会重新激活消息，无法无损复制当前的模型上下文。
- checkpoint 带有前缀长度和前缀消息的 sha256 摘要；派生时重新计算，不匹配就返回 `checkpointNotFound`，不做近似复制。
- 回滚上一轮只保留最后一个真实用户 Turn 之前的完整原生消息；没有用户 Turn 时返回 `invalidState`。
- 派生会保留 `model_config`、`profile_name`、cwd，复制后逐字段校验工具的输入和输出，并确认源消息没有变化。
- 源 Session 正在运行时，Adapter 在调用脚本前就拒绝派生（`HermesAdapter.#openGateway` 检查 `source.busy`）。
- 清理：`discardDerived()` 只接受由**同一个** `HermesGatewayHistory` 实例 `derive()` 出来、并在 `#derived` 中记有摘要的会话。脚本还会再次核对 `parent_session_id === 源 ID` 和内容摘要，二者都没变才删除；永远不删除源会话（脚本对 `child == sid` 报 `invalidState`）。

## 历史投影（`projectGatewayHistory`）

- Turn 身份使用 SessionDB 的真实 row ID 和原生 display identity。`user_originated_turn_view` / `_history_to_messages` 会排除内部续跑、压缩摘要和 hidden 行，但保留用户原始的技能命令显示。
- 工具的输入和输出都来自持久化的完整结果，不使用截断的 `summary`/`result_text`。
- gateway 持久化的工具结果没有保存渲染时的旧文件快照，所以历史恢复**不重建** Edit Diff，只保留工具的输入和输出。
