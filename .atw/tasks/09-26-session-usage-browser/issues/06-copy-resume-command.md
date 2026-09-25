# 06 — 复制指令

**What to build:** 每行（Claude Code、Codex、Pi、oh-my-pi）提供「复制指令」，复制「进入项目文件夹 + 恢复命令」的一整行，粘进本机终端即可继续。

**Blocked by:** 01
**Status:** ready-for-agent
**Impl:** ready

## Acceptance criteria

- [ ] macOS/Linux 生成 `cd <转义路径> && <命令>`，Windows 生成 PowerShell 等效写法
- [ ] 命令：claude --resume <id>、codex resume <id>、pi --session <id>、omp --resume <id>；实现前实际执行验证各命令
- [ ] 会话 ID 不在安全字符集内时不提供复制指令；Hermes、DSH 不提供
- [ ] 复制成功有简短反馈
- [ ] 纯函数测试覆盖各命令与含空格/引号/非 ASCII 路径的转义
