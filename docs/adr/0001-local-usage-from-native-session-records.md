# 用量统计读取 Harness 原生会话记录，而不是由 Host 记账

用量统计（仪表盘、会话列表）的数据来自本机各 Harness 自己写下的 Native Session 记录（如 `~/.claude/projects`、`~/.codex/sessions`、Pi 与 oh-my-pi 的会话目录），而不是由 codexhost Host 在收到 `session.usage.changed` 时落盘。原因是用户的绝大部分用量发生在 Codex Connect 之外（直接在终端运行 CLI），Host 只能看到其中极小一部分；而在 Codex Connect 内运行的会话同样会写入这些原生记录，因此只读原生记录即可覆盖全部用量，不需要第二份账本。

## Consequences

- Local Usage 的口径由各 Harness 的原生记录格式决定，Harness 升级改格式时统计可能失真，需要随之维护解析。
- Host 内存中的 Thread Usage 仍只服务当前 Thread 的实时展示，不作为历史统计来源。
