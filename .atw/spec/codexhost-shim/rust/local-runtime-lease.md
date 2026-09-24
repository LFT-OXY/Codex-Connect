# 本机 Host Runtime 租约（`local_runtime_lease.rs`）

同一个 `CODEXHOST_DATA_DIR` 下同时只能有一个本机 Host Runtime。Desktop 重连、重启 app-server 时会启动新 Shim，新 Shim 需要安全地接管旧 Host Runtime，并且在任何情况下都不能误伤无关进程或另一个 Desktop 的运行时。

## 何时启用

`run_proxy_with_observer` 仅在以下条件都成立时获取租约：不是 Desktop helper、`should_start_host_runtime` 为真、Host 路径已配置、不是受管远程 listener、设置了 `CODEXHOST_DATA_DIR`。其他调用完全不碰这些文件。

## 磁盘布局（都在 `CODEXHOST_DATA_DIR` 下）

| 路径 | 作用 |
|---|---|
| `local-host-runtime-owner.lock` | `fs2` 排他锁，串行化"观察 → 退役 → 删除 → 发布"整个变更 |
| `local-host-runtime-owner-v1/owner` | 所有者记录，文本 `key=value` 行 |
| `mapping-store/store.lock` | 旧版本 Host Runtime 留下的 JSON 锁，只用来找出需要退役的遗留运行时（`"pid"` 字段按文本解析） |

所有者记录格式（`OwnerRecord::encode`）：

```text
version=1
process_id=<shim pid>
process_started_at_micros=<shim start>
desktop_process_id=<shim 的父进程 pid>
child_process_id=<host runtime pid 或空>
child_process_started_at_micros=<host runtime start 或空>
```

- **写入时仍用 `version=1`**，并额外带启动时间字段，这样已发布的 v1 Shim 仍能读懂新记录（测试 `exact_owner_records_remain_readable_by_released_version_one_shims`）。解码时没有 `process_started_at_micros` 的 v1 记录视为旧格式 `VersionOne`；`version=2` 也能读。不要把写入的版本号改成 2。
- 记录通过"写 `owner.tmp-<pid>` + `atomic_replace_file`"发布。

## 获取流程（`LocalRuntimeLease::acquire`）

1. 阻塞获取 `local-host-runtime-owner.lock`，并在整个获取过程中持有。
2. `create_dir(local-host-runtime-owner-v1)` 成功即成为所有者：写入不含 child 的记录，然后退役遗留的 `mapping-store` 运行时。
3. 目录已存在时读取记录（最多等 500ms 让对方写完）；读不到就删目录重试。按记录状态处理：
   - 记录里的 Shim 进程还活着且是 codexhost（按启动时间确认实例，并用文件名匹配，允许 npm 升级后路径变化；Linux 还接受 `" (deleted)"` 后缀）：如果它的 Desktop 是另一个仍存活的进程，拒绝接管并报错（PID 1 不算，因为 Desktop 退出后遗留 Shim 会被 launchd/systemd 收养）；否则 `stop_owner`：先 SIGTERM Shim，等 4s（`HANDOFF_GRACE`），然后强杀 Host Runtime 的进程组和 Shim，再等 2s。
   - Shim 已退出或 PID 被复用：只终止记录中精确匹配的 child，**绝不向缺失或复用的 Shim PID 发信号**。
   - 进程存活但可执行文件不是 Shim：视为记录损坏，直接删除，不向任何一方发信号。
   - 旧 v1 记录：等待该 Shim 发布 child（最多 4s），再迁移成带启动时间的精确记录；等不到就拒绝接管（"refusing unsafe takeover"）。
4. 调用方 spawn Host Runtime 后调用 `set_child_process_id`：确认记录未被他人改动，写入 child 的 PID 和启动时间，**然后才释放变更锁**。在 child 发布之前一直持有锁，是为了防止另一个竞争者删掉我们刚建立的租约（注释："Without this lock, a delayed contender can delete a newer contender's lease"）。

## 释放（`Drop`）

- 仍持有变更锁（child 尚未发布）时，直接删除与自己匹配的记录。
- 已释放变更锁时只 `try_acquire`（非阻塞）：替换者可能正持有锁并等待我们退出，这时阻塞会造成双方互等死锁。拿不到锁就放弃清理，让替换者处理。
- 删除一律用 `remove_owner_if_matches`：只有磁盘上的记录与自己完全相同时才删目录。

## 平台差异与易错点

- Windows 的旧 v1 Shim 把 Host Runtime 放在 `KILL_ON_JOB_CLOSE` Job 里，Shim 消失后 child 必然也消失，所以 `ensure_no_live_version_one_child` 的 Windows 分支不需要追查 child；Unix 分支在 child 比 Shim 活得久时拒绝接管（测试 `refuses_version_one_takeover_when_the_recorded_child_outlives_its_shim`）。
- Windows 查询刚退出的进程可能暂时返回 `ERROR_ACCESS_DENIED`(5)/`ERROR_GEN_FAILURE`(31)，`process_identity.rs` 最多重试 5 次、间隔 20ms；`ERROR_INVALID_PARAMETER`(87) 视为已退出（PID 0 除外）。持续的权限错误保持"身份不确定"，不当成已退出。
- `fs2` 锁在 macOS 上是进程级的：同一进程内再开一个句柄也能拿到锁。所以锁竞争的单元测试只覆盖 Windows/Linux，macOS 靠 `tests/proxy.rs` 的跨进程测试 `replacement_waits_for_the_local_runtime_owner_mutation_lock`（模块测试上方注释）。
- 不要在 Drop 或交接路径里引入新的阻塞锁调用，也不要跳过 `remove_*_if_matches` 直接 `remove_dir_all`。
