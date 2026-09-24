# mapping-store（Node）

`@codexhost/mapping-store` 持久化外部 Thread 的**元数据和身份映射**：Host Thread ↔ Native Session Ref、Host Turn ↔ Native Turn Ref / Native Checkpoint Ref（即 Turn Anchor），另外还保存 Delegation 关系。它不保存 Transcript、消息正文或凭据；历史由 Adapter 从原生 Session 读取。一个存储目录同一时刻只允许一个进程写入。

## 上下游

- 依赖（`package.json`）：`shared-contracts`（`harnessIdSchema`、`hostThreadIdSchema`、`nativeSessionRefSchema` 等 ID schema）和 `zod`。
- 下游：`host-runtime` 在 `external-thread-repository.ts` 中通过 `ExternalThreadStore` 接口使用它，由 `createProductionExternalThreadStore` 构造。默认目录是 `${CODEXHOST_DATA_DIR 或 ~/.codexhost}/mapping-store`。其他使用方还有 `harness-session-import.ts`、`external-subagent-threads.ts`、`run-host-runtime.ts`（远程 listener 在多个会话间共享同一个 Store，并传 `closeMappingStoreOnExit: false`）。`protocol-core` 只引用它的 `packageMetadata`。
- 公开面（`src/index.ts`）：`MappingStore`、`MappingStoreError`、4 个 zod schema，以及各 `*Input` 类型。

## 文件清单

| 文件 | 何时阅读 |
|---|---|
| [persistence.md](./persistence.md) | 修改记录格式、写入路径、锁、启动恢复、并发，或排查 Windows / `STORE_LOCKED` 问题时 |

源码只有两个文件：`src/records.ts`（schema 和输入类型）、`src/mapping-store.ts`（约 990 行，只有 `MappingStore` 一个类）。

## 核心规则

- **内容无关**：`storedThreadRecordV1Schema` 是 `.strict()`，多出任何字段都会被拒绝（测试 "rejects content fields and cross-Session Checkpoints" 会用 `transcript` 字段验证）。不要往记录里加正文、预览文本或原生 payload。
- **身份一致性写在 schema 里**：`superRefine` 检查以下约束：`ready` 状态必须有 `nativeSessionRef`；Turn Ref 和 Checkpoint Ref 的 `harnessId` 与 `nativeSessionId` 必须和 Thread 一致；同一 Thread 内 Host Turn ID 和 Native Turn Ref 各自唯一。跨 Thread 的唯一性由 `#validateGlobal` 检查。Subagent 记录可以与父 Thread 共用 Native Session，因此不参与 `nativeSessions` 索引。
- **状态迁移全部走专用方法**：`createProvisional` → `commitReady`；Fork/Rollback 使用 `replaceReadySession` 或 `replaceReadySessionAfterLastTurn`，二者都要求传入 `expectedRevision` 和 `expectedNativeSessionRef`（乐观并发），并且只能保留当前 Turn 的精确前缀。Subagent 父 Session 被替换时使用 `rebindSubagentSession`，在一次记录变更内同时改写 ref、Turn 映射和 createRequestId。不要拆成多个 setter，否则会留下混合 Session 的中间状态（见源码注释）。
- **错误**：一律抛出 `MappingStoreError(code, message, { cause })`，code 取自 `MappingStoreErrorCode` 联合类型。IO 异常统一包装成 `IO_ERROR`，message 是固定英文，不含路径或内容。
- **返回副本**：所有读取方法都经过 `cloneRecord` 返回深拷贝，调用方修改返回值不会污染内存索引（测试 "returns defensive content-free enumeration copies"）。

## 改动前检查清单

1. 新增公共方法时，同步修改 `packages/host-runtime/src/external-thread-repository.ts` 的 `ExternalThreadStore` 接口，以及 host-runtime 测试中继承 `MappingStore` 的故障注入类（`test/app-server-host-fixture.ts`）。
2. 修改记录字段时，要先判断是否需要升级 `formatVersion`（目前是 `z.literal(1)`）。旧文件如果无法通过新 schema，启动时会被移到 `quarantine/`，相当于从用户视角"丢失"了 Thread。
3. Thread 记录的写操作必须经过 `#update` 或 `#enqueue`，不要直接调用 `#replaceFile`。
4. 所有 ID 都会成为文件名。`storedHostThreadIdSchema` 限制为 `[A-Za-z0-9._~-]`，不要放宽。
5. 定向验证：`npx vitest run --config tests/vitest.config.js packages/mapping-store/test/index.test.ts`（另有 `session-replacement`、`subagent-session`、`macos-lock` 三个测试文件）。修改锁逻辑时，要在 macOS 上实际运行 `macos-lock.test.ts`（它只在 darwin 上执行）。
