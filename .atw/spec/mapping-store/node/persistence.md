# 持久化：文件格式、原子写、锁与并发

## 目录布局（`MappingStore` 构造函数）

```
<directory>/
  store.lock                    # 单写者锁，内容为 JSON LockRecord
  store.lock.stale-<ms>         # 被判定为过期而移走的旧锁，下次 initialize 时清理
  threads/<hostThreadId>.json   # 主记录，文件名必须等于 `${hostThreadId}.json`
  backups/<hostThreadId>.json   # 上一版记录，只在更新时写入
  delegations/<delegationId>.json
  quarantine/<name>.<ms>.invalid[-delegation]
```

- 记录序列化为 `JSON.stringify(record, null, 2)` 加换行，文件权限 `S_IRUSR | S_IWUSR`。
- 不维护持久化索引。启动时读取全部文件，并在内存中重建 `#createRequests`、`#nativeSessions`、`#hostTurns` 等索引（测试 "enumerates 1000 valid startup records without a persistent query index"）。**不要新增索引文件。** 每次变更后都会全量执行 `#rebuildIndexes()`。

## 原子写（`#replaceFile`）

步骤依次为：

1. 调用 `beforeReplace`（仅测试使用的故障注入钩子）；
2. 以 `wx` 方式打开 `<target>.tmp-<uuid>`；
3. 写入内容并 `sync()`，然后关闭；
4. 如果是更新，先把旧的主文件 `copyFile` 到 `backups/`；
5. `rename` 临时文件覆盖目标文件。

任何一步失败，都会删除临时文件，并抛出 `IO_ERROR`，`cause` 是原始异常。

- 内存状态只在**写盘成功之后**更新（`#update` 中先 `#replaceFile` 再 `#records.set`）。测试 "keeps the prior durable and in-memory record when replacement fails" 锁定了这个顺序，不能颠倒。
- `rename` 失败时不重试。这一点和 `update-manager` 的 `replaceStatusFile` 不同，后者在 Windows 上遇到 `EACCES`/`EBUSY`/`EPERM` 时会退避重试。Windows 上的磁盘延迟通过 `tests/vitest.config.js` 调大超时来容忍，没有改写入路径。

## 启动恢复（`initialize`）

- 获取锁，然后清理 `threads/` 和 `delegations/` 下残留的 `.tmp-*`，以及根目录下的 `store.lock.stale-*`。
- 主记录无法解析时，从 `backups/` 读取并回写到主文件。备份也失败时，把主文件移到 `quarantine/` 并跳过，**不中断启动**。
- `state: "creating"` 且没有 `nativeSessionRef` 的记录属于未完成的临时（provisional）创建，启动时连同备份一起删除。
- Delegation 记录没有备份。解析失败或文件名与 ID 不一致时，直接移入 quarantine。
- 如果 `initialize` 中途失败，会调用 `close()` 释放锁后再抛出异常。

## 单写者锁（`#acquireLock` / `lockOwnerIsLive`）

- 以 `wx` 方式创建 `store.lock`，写入 `pid`、`instanceId`、`startedAt`、`executablePath`（`process.execPath`）和 `processStartedAt`。
- 锁已存在时，读取锁文件内容判断持有者是否仍然存活：
  - 所有平台先用 `process.kill(pid, 0)` 探测，`EPERM` 视为进程存活。
  - Linux 只看 PID 是否存在。
  - macOS 只有在发生锁冲突时才执行 `/bin/ps -p <pid> -o lstart=`（设置 `LC_ALL=C`，超时 1s）比对启动时间，容差 5s。ps 失败或输出为空时，视为锁仍然有效。
  - Windows 通过 `powershell.exe Get-Process` 比对可执行文件路径（统一成 `\` 并转小写）和 StartTime。旧格式的锁没有 `executablePath`，如果该 PID 属于非 Node 进程，就视为过期。
- 判定过期后，把旧锁 rename 成 `.stale-<ms>`，再重试一次。这次仍失败，或持有者存活，都抛出 `STORE_LOCKED`（"Another codexhost process owns Mapping Store"）。
- `close()` 会等待写队列清空，然后只删除 `instanceId` 与自己一致的锁文件。删除失败时忽略，由下一个持有者按 PID 判定。
- 相关事故：Windows 上 Computer Use 的辅助 app-server 会再次进入 Host Runtime，因为拿不到这把锁而以 `STORE_LOCKED` 退出（`docs/platforms/windows/windows-tool-compatibility.md`）。修复是在 Shim 层把辅助进程路由到官方 CLI，锁的语义本身没有改动。**不要为了解决这类问题放宽锁判定。**
- 测试：`index.test.ts` 覆盖 Windows 的 PID 复用与可执行文件复用（mock `execFileSync`），`macos-lock.test.ts` 用真实子进程验证 macOS 的判定逻辑。

## 并发

- `#enqueue` 用一条全局 Promise 链把 Thread 记录的写操作串行化（注释："A Store-wide queue caps write concurrency at one; shard only if measured throughput requires it"）。某个操作失败不会阻塞后续操作。
- `#update(hostThreadId, change)` 在队列内读取当前记录，把深拷贝交给 `change`。`change` 返回 `null` 表示没有变化，此时不写盘，revision 也不变（例如 `setArchived` 传入相同的值）。有变化时 `revision + 1`，并刷新 `updatedAt`。
- 需要"预期版本"语义的方法，在 `change` 内部比较 `expectedRevision`，不匹配时抛出 `MAPPING_CONFLICT`。测试 "rejects a stale edit after an earlier queued configuration write without losing indexes" 覆盖这种情况。
- **已知差异**：`createDelegation`、`setDelegationStatus`、`removeDelegation` 目前**没有**经过 `#enqueue`，是直接写文件再更新内存。并发调用同一个 Delegation 的状态更新时，最后写入者获胜。如果以后要给 Delegation 增加基于版本的条件更新，应先把这些方法纳入队列。
- Delegation 进入终态（`completed`、`failed`、`interrupted`）后，不会再回退到非终态。`setDelegationStatus` 遇到这种请求时直接返回当前记录，不报错。
