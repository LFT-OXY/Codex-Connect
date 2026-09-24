# 历史、Fork 与回滚

## 原生存储定位（`src/history.ts`）

- 根目录由 `getKimiCodeHome` 决定：优先 `KIMI_CODE_HOME`，其次 `<homeDirectory>/.kimi-code`，最后 `~/.kimi-code`。Adapter 各路径都显式传入 `kimiCodeHome`，测试靠它隔离真实目录。
- `locateKimiSession`：在 `session_index.jsonl` 中按 sessionId 找**最后一条**记录，跳过 `deleted` 或缺少 `sessionDir` 的记录。`sessionDir` 必须位于 `KIMI_CODE_HOME` 之内，否则抛错（测试："rejects path traversal outside kimi home"）。随后读取 `state.json`，校验 `state.id` 与 sessionId 一致，主代理目录取 `state.agents.main.homedir`，缺省为 `<sessionDir>/agents/main`。
- 标识：NativeSessionRef 的 `locator` 为 `{ cwd }`。Turn 和 Checkpoint 都使用 `turn:<turnId>`（`createKimiNativeTurnRef`、`createKimiNativeCheckpointRef`）。命令回合使用 `turn:command:<hostTurnId>`。

## wire.jsonl 解析

- `activeKimiWireRecords`（`src/wire-history.ts`）：Kimi 执行 undo 后，旧记录仍保留在 `wire.jsonl` 中，由 `agent.switched` 开出新分支，`base.line` 从 1 开始计数。该函数只沿当前活动分支的祖先链取记录。分支信息不合法时直接抛错，不做容错猜测。只有**最后一行**的 JSON 损坏会被容忍（视为正在写入）；中间行损坏会抛错。`command-history.ts` 采用相同规则。
- `parseKimiWireLog` 按 `turnId` 聚合 `turn.prompt`、`agent.turn.started`、`turn.ended`、`context.append_loop_event`、`file_history.*` 等记录。遇到 `context.undone` 时，删除 `turnId >= fromTurnId` 的 turn。只处理 `agentId` 为空或等于 `"main"` 的记录，子代理记录被丢弃。
- 回合结果只按原生 `reason` 映射：`completed/done/success` 为 succeeded，`cancelled/user_cancelled/aborted` 为 cancelled，`failed/error` 为 failed，其余一律为 `unknown`。`unknown` 回合不能作为 fork 或回滚的基点。
- fileChange：从主代理目录读取 `file_history.tracked` 与 `file_history.checkpoint` 所引用的文件快照，用 `diff.createTwoFilesPatch` 生成统一 diff。
- usage：`extractKimiUsageFromWireLog` 汇总 `usage.record`，上下文占用取最后一次 `token_counting.*` 的值。
- 历史文件存在但内容为空时，返回空快照；历史文件缺失时报错，不返回空快照（测试："preserves a present but empty native history" 和 "reports a missing native history instead of returning an empty snapshot"）。

## 命令日志（`src/command-history.ts`）

ACP slash command 的回复不会写入 `wire.jsonl`。插件把命令回合作为 `HostTurnSnapshot` 追加到 `<sessionDir>/codexhost-commands.jsonl`，文件头注释说明了这样做的目的：保留真实回复，同时不改变原生对话上下文。

- 读取时校验每条记录的 `harnessId`、`nativeSessionId` 和 `turn:command:` 前缀，不匹配就抛错。
- `KimiSession.readSnapshot` 把原生 turn 与命令 turn 合并后按 `startedAtMs` 排序。
- 回滚生成派生会话时，`copyKimiCommandHistory` 会把 sessionId 改写成派生会话的 ID，再复制过去。

## Fork（ACP `unstable_forkSession`）

`KimiAdapter.open({ kind: "fork" })` 按以下顺序检查，任何一步失败都会先关闭 transport 再返回错误：

1. `sourceRef` 与 `checkpoint` 都必须属于 `kimi-code`，而且属于同一个源会话，否则返回 `invalidRequest` 或 `checkpointNotFound`。
2. 源会话必须能定位到，否则返回 `sessionNotFound`。`cwd` 必须与 `state.cwd` 相同，否则返回 `unsupported`（`forkAcrossCwd: false`）。
3. **只允许从最新的 checkpoint fork**，而且最新 turn 不能是 `unknown`。原因是 ACP fork 没有指定历史位置的参数（测试："rejects non-head checkpoints because ACP fork has no history boundary"）。不要为了支持中间位置 fork 而去截断文件。
4. fork 后的 usage 先从新会话读取，读不到时回退到源会话。

## 回滚上一回合（`#rollbackLastTurn` + `src/native-rollback.ts`）

ACP 没有 undo 接口。`rollbackKimiNativeSession` 会**临时启动一个原生 `kimi web --host 127.0.0.1 --port 0 --no-open` 进程**，从 stdout/stderr 中解析 `http://127.0.0.1:<port>/#token=<t>`，然后按顺序调用：

1. `POST sessions/<id>:fork`：生成派生会话，源会话保持不变。
2. `GET sessions/<fork>/status`：读取 model、thinking_level 和 permission。`plan_mode` 对应 `plan`，`manual` 对应 `default`。
3. `POST sessions/<fork>:undo { count: 1 }`。
4. 在 `finally` 中调用 `shutdown`，等待 2 秒后仍未退出就 `SIGKILL`。

失败处理：如果派生会话已经创建，先调用 `:archive` 归档；归档也失败时，在错误信息中写明残留的派生会话 ID。原生错误码映射如下：`40901` 为 `sessionBusy`，`40911` 为 `unsupported`（遇到压缩边界或缺少 checkpoint），其余为 `nativeFailure`。

Adapter 侧的前置检查和后置校验：

- 如果源会话属于其他 Harness，在产生任何原生副作用之前就拒绝（测试："rejects rollback of another harness before native side effects"）。
- 最新回合是命令回合时返回 `unsupported`，因为无法撤销 slash command 的副作用。最新回合是 `unknown` 时返回 `sessionBusy`。
- 回滚后必须满足"派生会话的 turn 与源会话去掉最后一个 turn 后逐项 `isDeepStrictEqual`"，否则报错；报错信息中会写明原会话保持不变以及派生会话 ID。最后以 `resume` 打开派生会话，使用原生 status 返回的 model/thinking/mode 作为默认配置。
- 这个流程的原则写在 `native-rollback.ts` 的注释里："Never edit Kimi's wire/state files ourselves"。不要改成直接截断 `wire.jsonl`。

## 验证

```bash
npx vitest run --config tests/vitest.config.js packages/adapters/kimi-code/test/history-and-diff.test.ts packages/adapters/kimi-code/test/rollback.test.ts packages/adapters/kimi-code/test/kimi-adapter.test.ts packages/adapters/kimi-code/test/review-regressions.test.ts
```
