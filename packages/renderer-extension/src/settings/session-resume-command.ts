/** A pasted line must stay one line and one command. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
/** PowerShell also ends single-quoted strings at these typographic quotes. */
const POWERSHELL_QUOTES = /['‘’‚‛]/gu;

export type SessionCommandShell = "posix" | "powershell";

/**
 * One line that enters the Session's project folder and runs the Harness's resume command, or null
 * when there is no command or the folder cannot stay on one line. Host supplies only commands
 * without shell syntax, so the folder is the only part that needs quoting.
 */
export function sessionResumeCommand(
  session: { resumeCommand: string | null; cwd: string | null },
  shell: SessionCommandShell,
): string | null {
  const { resumeCommand: command, cwd } = session;
  if (!command || !cwd || CONTROL_CHARACTER.test(cwd)) return null;
  if (shell === "posix") return `cd -- '${cwd.replaceAll("'", `'\\''`)}' && ${command}`;
  // Windows PowerShell 5.1 has no `&&`; `$?` stops the command when the folder is missing.
  return `Set-Location -LiteralPath '${cwd.replaceAll(POWERSHELL_QUOTES, "$&$&")}'; if ($?) { ${command} }`;
}
