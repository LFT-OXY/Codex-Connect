# 历史、turn 身份与 Fork

Cursor ACP 在 prompt 完成和回放里都不给持久的 user turn ID。本包因此读取 Cursor 未公开的本地存储取得身份，并用 CLI 交互命令实现 Fork。两者都依赖私有格式，原则是**失败即关闭**：结构对不上就报错，不回退、不合成。

## 原生历史（`src/native-history.ts`）

- 位置：`cursorConfigDirectory` 依次取 `CURSOR_CONFIG_DIR`、`$XDG_CONFIG_HOME/cursor`、`~/.cursor`；会话目录为 `acp-sessions/<uuid>`（`cursorSessionDirectory` 校验 UUID 格式，防止路径穿越）。
- `readCursorNativeHistory` 以 `DatabaseSync(..., { readOnly: true })` 打开 `store.db`，在 `BEGIN` 内读取 `meta` 表 key `"0"`（hex JSON，含 `agentId`、`latestRootBlobId`），再用自带的有界 protobuf 解码器 `protobufBytes` 沿 root → field 8 → 容器 → turn → user blob 取出 turn `id`（field 2）、`text`（field 1）和 `rewindRoot`（field 10，且该 blob 必须存在）。注释写明这是按 2026.09.08 观察到的格式，不是官方 API，只解码身份，不解码 provider 消息、密钥和签名。
- `meta.json` 的 `cwd` 必须与当前 cwd 相同（`cursorSameWorkspace` 允许 realpath 相同的符号链接）。
- 返回的 `revision` 就是 `latestRootBlobId`，用作快照缓存键。`allowMissing` 只用于全新会话（`#fresh`），resume 时历史缺失是错误（测试 `does not treat missing history as empty on resume`）。

## turn 身份与快照（`src/adapter.ts`、`src/projection.ts` `cursorSnapshot`）

- 每轮 `#run` 前后各读一次原生 turn：必须恰好新增 1 个、前缀不变、新 turn 文本等于提交文本，才生成 `nativeTurnRef`；否则成功 turn 改判为失败。取消可能发生在原生持久化之前，此时终态没有 `nativeTurnRef`，这是预期行为。
- 快照体来自 `session/load` 的回放通知：按 `user_message_chunk` 分组，组数、顺序、文本必须与原生 turn 一一对应，否则抛 "Cursor replay/native ... mismatch"。历史 outcome 一律 `unknown`，因为 ACP 回放不含 stop reason，不要从是否有助手文本推断成功。
- 快照缓存：`#snapshot` 以 revision 为键；revision 变化（即使没有新 turn）或本地新 turn 会失效。回放前后 revision 必须一致才缓存（测试 `rejects a changing root during replay ...`）。resume 时只有 load 前后 revision 相同才预填缓存。返回的快照都是 `structuredClone` 并带当前 `initialState`。
- 回放 transport 使用 `delegation: false, loadModelCatalog: false`，不查询账户模型目录（测试 `reads history without waiting for a model catalog that never responds`）。
- resume 时校验 `knownTurnRefs` 都还存在于原生历史，否则失败，不重新编号。

## Checkpoint（`src/fork-support.ts`）

- 形状：`{ harnessId: "cursor-cli", checkpointId: <原生 turn id>, locator: { kind: "cursor-turn" }, formatVersion: 1 }`。`validateCursorFork` 还接受旧的 `cursor-tail` locator，保持已保存 checkpoint 可用。
- 只有 `cursorForkAvailable()` 为真时才发 checkpoint：live 成功 turn 带 checkpoint；快照中只有最后一轮或"下一轮有 `rewindRoot`"的 turn 才带（历史边界需要下一轮的原生回退点）。

## Fork / 修订上一条（`src/fork.ts`、`src/fork-terminal.ts`、`CursorAdapter.#fork`）

ACP 没有 Fork 或回滚操作，这里用原生 CLI 完成，`rollbackLastTurn` 与 Fork 共用同一事务（无 checkpoint 表示丢弃最后一轮，单轮时得到空的可写会话；空历史直接拒绝）。

1. 锁源会话：`source.lockForFork()`，忙则 `sessionBusy`；跨工作区返回 `unsupported`。
2. `forkCursorSession`：记录源 `storeIdentity`（root + 所有 blob 的 sha256）；在 `mkdtemp` 私有目录里写一份 `cli-config.json`（复制用户配置并仅在此处打开 `rewind: true`，不改用户配置）；用 SQLite `backup` 把源库复制到 `chats/<md5(realpath(cwd))>/<id>`（CLI 按解析后的 cwd 哈希，macOS 上 `/var` 是符号链接）。
3. `runCursorForkTerminal`：`/bin/sh -c 'cat | /usr/bin/script ...'` 提供 PTY（BSD script 不接受 Node 的 socketpair stdin；darwin 与 linux 的 `script` 参数不同），`stty rows 40 cols 140` 设真实终端尺寸。以 `--trust --resume <id>` 启动 CLI，等 "Add a follow-up"，输入 `/fork` 并**只在菜单出现原生描述后**才回车；历史边界再执行 `/rewind`，按上箭头步数选择，明确选 "Restore conversation"（不恢复文件）。rewind 没有可靠的成功提示，以 `complete()` 检查持久化 root 等于目标 `rewindRoot` 为准。终端输出只保留 64KB 尾部用于匹配，绝不转发给 Host。结束后按进程组 SIGKILL。
4. 校验派生会话：`chats` 下恰好一个新会话，`agentId` 匹配，root 等于期望值，blob 哈希与源一致（内容未被改写），源库期间未变化；然后 `mkdir(destination)`（非 recursive，绝不覆盖已有原生会话）并复制到 `acp-sessions`，再校验保留的 turn 与期望前缀一致。
5. 目标 ACP transport 的 `prepare()` 与第 2–4 步并行（`Promise.allSettled`），完成后以 `resume` 打开派生会话并按源会话（或 rollback 输入）的模型/Thinking/模式恢复；同环境且模型列表一致时复用源的参数化目录（`cachedModels`）。
6. 打开后再比对派生与源的原生 turn，全部一致才 `derived.commit()`；任何失败都关闭会话与 transport 并 `discard()` 只删除本次创建的目标。临时目录在 `finally` 中删除；Host 被强杀可能遗留临时目录。

坑：CLI 菜单文案（"Fork the current chat into a new session"、"Pick a past turn to rewind to." 等）变化会让 Fork 超时失败（默认 60s，`timeoutMs` 覆盖），这是预期的失败方式，不要加模糊匹配或合成历史的回退。

## 真实 Cursor smoke（需要已登录的 `cursor-agent`，会发起真实模型请求）

先 `npm run build:typescript`（或 `npx tsc -b packages/adapters/cursor-cli`），脚本直接导入 `dist/`：

| 脚本 | 用途 |
|---|---|
| `node tools/cursor-harness-smoke.mjs <workspace> [--resume]` | 多轮执行，再用新进程 resume |
| `node tools/build-cursor-plugin.mjs <新的绝对目录>` | 用 `buildHarnessPlugin` 打包可重定位插件和 `enabled.json`；目录已存在即失败；不安装、不改用户配置 |
| `node tools/cursor-controls-smoke.mjs <candidate> <workspace>` | 经 `loadHarnessPlugins` 加载打包插件，拒绝一次原生 shell 审批并取消流式 turn |
| `node tools/cursor-host-protocol-smoke.mjs <candidate> <workspace> <new-state-dir>` | 走真实 `AppServerHost` JSON-RPC 路由 |
| `node tools/cursor-fork-smoke.mjs [workspace]` | 在隔离 `CURSOR_CONFIG_DIR` 下验证历史/尾部 Fork、修订、空历史拒绝、重启恢复；`CURSOR_FORK_PLUGIN_ROOT` 指向打包目录时经公共 Loader 运行；`--resume-fixture <root>` 重试 |

新增 runtime 依赖时要同步 `build-cursor-plugin.mjs` 的 `allowedRuntimePackages`。不要用 `npm start` 代替这些验证（会停止正在运行的 Desktop）。

## 文档与代码的差异

- `docs/harnesses/cursor/cursor-cli-experimental.md` 写原生存储在 `~/.cursor/acp-sessions`；代码还支持 `CURSOR_CONFIG_DIR` 和 `XDG_CONFIG_HOME`，以代码为准。
- 同一文档称 Desktop Agent Picker "still based on a static Harness list"，本包代码不涉及，未核实是否仍成立。
