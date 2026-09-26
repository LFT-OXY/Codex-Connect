import { describe, expect, it } from "vitest";

import { sessionResumeCommand } from "../../src/settings/session-resume-command.js";

const COMMAND = "claude --resume 11111111-1111-4111-8111-111111111111";

function command(cwd: string | null, shell: "posix" | "powershell" = "posix") {
  return sessionResumeCommand({ resumeCommand: COMMAND, cwd }, shell);
}

describe("Session resume command", () => {
  it("enters the project folder and runs the Harness's resume command", () => {
    expect(command("/work/project")).toBe(`cd -- '/work/project' && ${COMMAND}`);
    expect(command("C:\\Work\\Project", "powershell")).toBe(
      `Set-Location -LiteralPath 'C:\\Work\\Project'; if ($?) { ${COMMAND} }`,
    );
  });

  it("quotes paths with spaces, quotes, shell syntax and non-ASCII for each shell", () => {
    expect(command("/work/my project/it's $(x) `y` 项目")).toBe(
      `cd -- '/work/my project/it'\\''s $(x) \`y\` 项目' && ${COMMAND}`,
    );
    expect(command("-dash")).toBe(`cd -- '-dash' && ${COMMAND}`);
    expect(command("C:\\A B\\it's ‘typographic’ $env:X 项目", "powershell")).toBe(
      `Set-Location -LiteralPath 'C:\\A B\\it''s ‘‘typographic’’ $env:X 项目'; if ($?) { ${COMMAND} }`,
    );
  });

  it("offers nothing without a command, a working directory or a single-line path", () => {
    expect(sessionResumeCommand({ resumeCommand: null, cwd: "/work" }, "posix")).toBeNull();
    expect(command(null)).toBeNull();
    expect(command("/work/line\nbreak")).toBeNull();
  });
});
