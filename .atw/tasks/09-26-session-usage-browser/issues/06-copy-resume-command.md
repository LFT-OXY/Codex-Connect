# 06 — 复制指令

**What to build:** 每行（Claude Code、Codex、Pi、oh-my-pi）提供「复制指令」，复制「进入项目文件夹 + 恢复命令」的一整行，粘进本机终端即可继续。

**Blocked by:** 01
**Status:** done
**Impl:** ready

## Acceptance criteria

- [x] macOS/Linux 生成 `cd <转义路径> && <命令>`，Windows 生成 PowerShell 等效写法
- [x] 命令：claude --resume <id>、codex resume <id>、pi --session <id>、omp --resume <id>；实现前实际执行验证各命令
- [x] 会话 ID 不在安全字符集内时不提供复制指令；Hermes、DSH 不提供
- [x] 复制成功有简短反馈
- [x] 纯函数测试覆盖各命令与含空格/引号/非 ASCII 路径的转义

## 实现记录

- 命令核实（2026-09-26，本机）：以不存在的会话 ID、关闭 stdin 运行 `claude --resume <id>`（输出 “No conversation found with session ID”）、`pi --session <id>`（“No session found matching”）、`omp --resume <id>`（“Session … not found”），均确认参数被识别并按会话 ID 查找。`codex resume <id>` 在非终端下报 “stdin is not a terminal”，伪终端中 TUI 无法自动验证到结论；按 `codex resume --help`（`codex resume [OPTIONS] [SESSION_ID] [PROMPT]`）确认。
- POSIX 引号在 zsh 中以含 `'`、`$(x)`、反引号、中文与空格的目录实测可进入；本机没有 PowerShell，Windows 写法只有单元测试覆盖。
- Windows 用 `Set-Location -LiteralPath '…'; if ($?) { … }`：Windows PowerShell 5.1 没有 `&&`，`$?` 保证目录不存在时不在错误目录运行。平台判断复用更新页已有的 `isWindowsRenderer`（移到 `settings/renderer-platform.ts` 供两处共用）。
- 工作目录未知或含控制字符时不提供指令。
- 审查后调整（提交 b036cfb4，用户决定）：恢复命令改由各 Adapter（官方 Codex 由 Codex 运行时）的 `nativeUsage.resumeCommand` 提供，Host 校验会话 ID 安全字符集与命令格式后放进会话行 `resumeCommand`；Renderer 只负责进入工作目录部分的引号与平台写法。
