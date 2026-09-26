# 04 — 接入官方 Codex 用量

**What to build:** 本机 Codex 原生会话记录的用量进入统计，用量页出现 Codex 卡片并参与占比、明细与统计块。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** done

## Acceptance criteria

- [x] host-runtime 的 Codex 运行时提供同形状的读取器，读取 sessions 与 archived_sessions（遵循 CODEX_HOME）
- [x] 累计值差分、输入扣除缓存、模型取最近 turn_context、Fork 重放段跳过、对话数按非零 token_count 事件计
- [x] 推理已含在输出中，不重复计 Token 与费用
- [x] 读取器测试覆盖上述格式边角；Host 请求层测试断言 Codex 卡片
- [x] 产品文档同步更新

## Implementation notes

- 读取器：`packages/host-runtime/src/codex-runtime/codex-native-usage.ts`（`codexNativeUsage(permanentHome)`），`LocalUsageService` 新增可选输入 `officialCodexUsage`，记录固定归属 `"codex"`、显示名 "Codex"；shared-contracts 结果 `harnessId` 放宽为 `"codex" | 插件 ID`。契约与格式细节见 `.atw/spec/host-runtime/node/local-usage.md`。
- Fork 重放（用户确认的取舍）：rollout 没有可靠的重放段结束标记，不做时间戳阈值硬跳过；每条 `session_meta` 更新 `historyId`，去重键 = `historyId + total/last 签名`，重放副本与父会话记录同键，Host 只计一次。父会话在被读取前就已删除时，重放用量按 Fork 时间计入一次；兄弟 Fork total 与 last 五项全同会撞键（概率极低）。
- 累计值差分：真实数据中累计值会在文件中途重启，重启后可能恰好大于上次（total == last），此时按 last 计入；累计值不变的重复事件不计。
- 本机真实记录（97 个文件、821 个非零事件）首次全量约 120 ms，增量约 9 ms；Token 分项与独立脚本求和完全一致。`cache_write_input_tokens` 按 `total_tokens = input + output` 视为输入的子集（本机数据均为 0，未能用非零样本验证）。
- 未覆盖：`AppServerHost` 传入 `permanentHome` 的接线没有单独测试（一行改动）；Codex 读取器的 `completeLines` 与 Claude Adapter 中的同名辅助函数重复（host-runtime 不能引用 Adapter），等 Pi/oh-my-pi 接入时再考虑共享位置。
