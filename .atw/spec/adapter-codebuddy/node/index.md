# adapter-codebuddy（Node）

> 通用约定见 `.atw/spec/adapters/node/index.md`（plugin.ts 工厂、manifest、HarnessResult、command.ts、测试组织等）。本目录只写 CodeBuddy 特有内容。

`@codexhost/adapter-codebuddy` 通过已安装、已登录的 `codebuddy` CLI 的原生 ACP（`codebuddy --acp`，stdio NDJSON，`@agentclientprotocol/sdk` 的 `ClientSideConnection`）接入 CodeBuddy。原生 JSONL 历史、`_codebuddy.ai/*` 扩展、`/fork` 派生流程和子 Agent Transcript 都只在本包处理。

- 依赖（`package.json`）：`@agentclientprotocol/sdk@1.3.0`、`@codexhost/harness-adapter`、`@codexhost/harness-discovery`、`@codexhost/harness-broker`（macOS 受管远程时走 Broker）、`@codexhost/shared-contracts`、`diff`。
- 下游：除 Host 通过 `manifest.json` 加载外，**`@codexhost/adapter-workbuddy` 直接依赖本包**，复用 `CodeBuddyAdapter`、`CodeBuddyAcpClient`、`CodeBuddyRuntimeProfile`、`modelRef`、`codeBuddyNativeHistory` 等公开导出（见 `src/index.ts`）。Adapter 依赖另一个 Adapter 的情况全仓只有两处（另一处是 `adapter-qoder-cn` → `adapter-qoder`）。改公开导出前必须同时检查 `.atw/spec/adapter-workbuddy/node/index.md`。
- 覆盖路径：`CODEXHOST_CODEBUDDY_COMMAND`（`src/command.ts` 的 `codeBuddyDiscoverySpec`），历史根 `CODEBUDDY_CONFIG_DIR`，默认 `~/.codebuddy`。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [protocol-and-session.md](protocol-and-session.md) | 改 ACP 客户端、进程生命周期、配置（Model/Thinking/Permission）、审批与问题、命令目录、取消恢复、RuntimeProfile 时 |
| [history-and-derivation.md](history-and-derivation.md) | 改原生 JSONL 历史投影、Checkpoint、Fork / rollbackLastTurn 派生、子 Agent Transcript 复制时 |
| `docs/harnesses/codebuddy/codebuddy-harness-integration.md` | 需要知道某个原生行为是在哪个 CLI 版本（2.148 / 2.149 / 2.151）上实测确认的 |

## 源码地图（`packages/adapters/codebuddy/src`）

| 文件 | 职责 |
|---|---|
| `codebuddy-adapter.ts` | `CodeBuddyAdapter`：inspect（按 cwd 缓存）、open（create/resume/fork/rollbackLastTurn）、`subagents.readSnapshot` |
| `session.ts`（约 660 行） | `CodeBuddySession`：Turn、配置、命令执行、取消后重建进程、故障收敛 |
| `acp-client.ts` | `CodeBuddyAcpClient`：一个 Session 一个子进程；`_codebuddy.ai/*` 扩展调用 |
| `common.ts` | `CodeBuddyRuntimeProfile`、`CodeBuddyError`、`nativeError`、`bounded` 超时 |
| `configuration.ts` | `configOptions` → Model/Thinking/Permission 目录；`cb.<base64url>` Model Ref |
| `history.ts`（约 720 行） | 原生 JSONL 定位、归属校验、父链解析、快照投影、Usage |
| `derivation.ts`（约 900 行） | Fork / rollbackLastTurn 的多进程派生事务 |
| `copy-cleanup.ts` | 派生用管理进程的 `--serve` 本地 HTTP 删除端点 |
| `slash-commands.ts` / `interactions.ts` / `projection.ts` | 命令目录与排除表；审批/问题；ACP 更新 → Host Item |
| `subagents.ts` / `subagent-history.ts` / `child-provenance.ts` / `subagent-tool.ts` / `file-observation.ts` | 原生 Agent 子任务观察、子 Transcript 读取与前缀校验、文件指纹缓存 |

## 技术债

- `derivation.ts` 已接近 900 行，`history.ts` 约 720 行。新的派生或历史逻辑优先放进独立模块（参照 `child-provenance.ts`、`copy-cleanup.ts` 的拆法）。
- `codeBuddyNativeHistory` 的第四个参数兼容旧签名：传字符串时被当作 `inheritedContents`（`history.ts`）。新代码传 `profile` + `transaction` 对象，不要再加新的重载形式。

## 改动前检查清单

1. 所有逻辑都要经 `CodeBuddyRuntimeProfile` 参数化（显示名、Harness ID、配置根环境变量、项目目录编码、历史能力、命令目录）。不要写 `if (harnessId === "workbuddy")`；差异放进 Profile 字段。
2. 修改 `src/index.ts` 的导出或 `CodeBuddyAdapterOptions` / `CodeBuddyInvocationFactory` 签名时，同时构建并运行 WorkBuddy 的测试（它按包名导入本包 `dist`）。
3. 能力声明只写原生已验证的操作：`CODEBUDDY_CAPABILITIES.history` 为 `fork: true, forkAcrossCwd: false, rollbackLastTurn: true`（`configuration.ts`）。跨目录 Fork 只对设置了 `historyCapabilities.forkAcrossCwd` 的 Profile 开放。
4. 原生 stderr 一律丢弃（`acp-client.ts` 的 `stderr.on("data", () => {})`，注释：可能含凭据）。不要把它接进错误的 `stderrTail`。
5. 历史读取、派生和子 Transcript 读取都是“失败即关闭”：身份、cwd、父链、大小（64 MB）、符号链接任一不符就报错，不要改成容错跳过。
6. 普通 Prompt 必须恰好对应一个新持久化 Native Turn（`session.ts` 的 `#run`，错误信息 `Could not identify exactly one persisted Native Turn`）。改投影时保持该不变量。

## 定向验证

```sh
npm run build:typescript   # WorkBuddy 测试按包名解析到 dist
npx vitest run --config tests/vitest.config.js packages/adapters/codebuddy/test
npx vitest run --config tests/vitest.config.js packages/adapters/workbuddy/test
```

测试的公共假客户端在 `test/fixtures.ts`（`fixture()`、`configOptions()`）；需要真实子进程的用例用 `test/fixtures/acp.mjs`（最小 ACP 服务端）和 `copy.mjs`（模拟 print 复制）。
