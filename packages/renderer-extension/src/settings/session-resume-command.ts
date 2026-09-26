/**
 * Session IDs come from local files other programs can write. Only this shell-safe alphabet is
 * pasted unquoted into a terminal; anything else gets no command.
 */
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
/** A pasted line must stay one line and one command. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
/** PowerShell also ends single-quoted strings at these typographic quotes. */
const POWERSHELL_QUOTES = /['‘’‚‛]/gu;

const RESUME_COMMANDS: Readonly<Record<string, (id: string) => string>> = {
  "claude-code": (id) => `claude --resume ${id}`,
  codex: (id) => `codex resume ${id}`,
  pi: (id) => `pi --session ${id}`,
  omp: (id) => `omp --resume ${id}`,
};

export type SessionCommandShell = "posix" | "powershell";

/**
 * One line that enters the Session's project folder and resumes it in its Harness's CLI, or null
 * when the Harness has no resume command or the Session cannot be resumed safely from a terminal.
 */
export function sessionResumeCommand(
  session: { harnessId: string; nativeSessionId: string; cwd: string | null },
  shell: SessionCommandShell,
): string | null {
  const resume = RESUME_COMMANDS[session.harnessId];
  const { cwd } = session;
  if (
    !resume ||
    !SAFE_SESSION_ID.test(session.nativeSessionId) ||
    !cwd ||
    CONTROL_CHARACTER.test(cwd)
  ) {
    return null;
  }
  const command = resume(session.nativeSessionId);
  if (shell === "posix") return `cd -- '${cwd.replaceAll("'", `'\\''`)}' && ${command}`;
  // Windows PowerShell 5.1 has no `&&`; `$?` stops the command when the folder is missing.
  return `Set-Location -LiteralPath '${cwd.replaceAll(POWERSHELL_QUOTES, "$&$&")}'; if ($?) { ${command} }`;
}
