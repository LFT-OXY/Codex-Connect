# 原生用量记录的解析放在各自的 Adapter 中

读取并解析某个 Harness 原生会话记录中用量的逻辑，归属该 Harness 的 Adapter，作为 Adapter 的可选能力暴露给 Host；官方 Codex 没有 Adapter，其解析放在 host-runtime 的 Codex 运行时中。我们没有采用参考实现（TokenTracker）那种把所有 Harness 解析器集中到一个用量模块的做法：那样移植更快，但违反“Harness 专属细节只留在对应 Adapter 内”的边界规则，并且每新增一个 Harness 都要改动中心模块。

## Consequences

- 未安装某个 Harness 插件时，该 Harness 的用量不会被统计。
- Host 只负责汇总各 Adapter 交出的统一用量数据、计价与缓存，不理解任何 Harness 的记录格式。
