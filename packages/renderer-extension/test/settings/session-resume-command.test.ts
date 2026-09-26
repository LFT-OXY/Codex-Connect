import { describe, expect, it } from "vitest";

import { sessionResumeCommand } from "../../src/settings/session-resume-command.js";

const ID = "11111111-1111-4111-8111-111111111111";

function command(harnessId: string, cwd: string | null, shell: "posix" | "powershell" = "posix") {
  return sessionResumeCommand({ harnessId, nativeSessionId: ID, cwd }, shell);
}

describe("Session resume command", () => {
  it("enters the project folder and resumes in each Harness's CLI", () => {
    expect(command("claude-code", "/work/project")).toBe(
      `cd -- '/work/project' && claude --resume ${ID}`,
    );
    expect(command("codex", "/work/project")).toBe(`cd -- '/work/project' && codex resume ${ID}`);
    expect(command("pi", "/work/project")).toBe(`cd -- '/work/project' && pi --session ${ID}`);
    expect(command("omp", "/work/project")).toBe(`cd -- '/work/project' && omp --resume ${ID}`);
    expect(command("claude-code", "C:\\Work\\Project", "powershell")).toBe(
      `Set-Location -LiteralPath 'C:\\Work\\Project'; if ($?) { claude --resume ${ID} }`,
    );
  });

  it("quotes paths with spaces, quotes, shell syntax and non-ASCII for each shell", () => {
    expect(command("pi", "/work/my project/it's $(x) `y` 项目")).toBe(
      `cd -- '/work/my project/it'\\''s $(x) \`y\` 项目' && pi --session ${ID}`,
    );
    expect(command("pi", "-dash")).toBe(`cd -- '-dash' && pi --session ${ID}`);
    expect(command("omp", "C:\\A B\\it's ‘typographic’ $env:X 项目", "powershell")).toBe(
      `Set-Location -LiteralPath 'C:\\A B\\it''s ‘‘typographic’’ $env:X 项目'; if ($?) { omp --resume ${ID} }`,
    );
  });

  it("offers nothing without a CLI, a working directory, a single-line path or a safe ID", () => {
    expect(command("hermes", "/work")).toBeNull();
    expect(command("deepseek-harness", "/work")).toBeNull();
    expect(command("claude-code", null)).toBeNull();
    expect(command("claude-code", "/work/line\nbreak")).toBeNull();
    for (const nativeSessionId of ["", "-flag", "a b", "a;rm", "$(x)", "a/b", "x".repeat(201)]) {
      expect(
        sessionResumeCommand({ harnessId: "claude-code", nativeSessionId, cwd: "/work" }, "posix"),
      ).toBeNull();
    }
  });
});
