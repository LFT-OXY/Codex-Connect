import { describe, expect, it } from "vitest";

import { localSessionsQueryParamsSchema, localSessionsQueryResultSchema } from "../src/index.js";

const session = {
  harnessId: "claude-code",
  nativeSessionId: "native-1",
  title: "Title",
  cwd: "/work/project",
  project: "owner/project",
  model: "claude-synthetic-1",
  startedAt: 1,
  lastActivityAt: 2,
  activeMs: 1,
  usage: { totalTokens: 3, estimatedCostUsd: 0.5 },
  turns: 1,
  edits: 0,
  subagents: 2,
  threadId: "thread-1",
  resumable: true,
  running: null,
  resumeCommand: "claude --resume native-1",
};
const view = {
  status: "ready",
  sessions: [session],
  harnesses: [{ harnessId: "claude-code", name: "Claude Code" }],
  failures: [],
};

describe("Local Sessions contract", () => {
  it("accepts a refresh flag only", () => {
    expect(localSessionsQueryParamsSchema.parse({ refresh: true })).toEqual({ refresh: true });
    expect(localSessionsQueryParamsSchema.safeParse({}).success).toBe(false);
    expect(localSessionsQueryParamsSchema.safeParse({ refresh: true, query: "x" }).success).toBe(
      false,
    );
  });

  it("accepts Sessions with or without usage, and read progress", () => {
    expect(localSessionsQueryResultSchema.parse(view)).toEqual(view);
    const importOnly = {
      ...session,
      harnessId: "hermes",
      usage: null,
      turns: null,
      edits: null,
      activeMs: null,
      startedAt: null,
      model: null,
      running: false,
    };
    expect(
      localSessionsQueryResultSchema.safeParse({ ...view, sessions: [importOnly] }).success,
    ).toBe(true);
    expect(
      localSessionsQueryResultSchema.parse({
        status: "reading",
        progress: { processed: 1, total: 2 },
      }),
    ).toMatchObject({ status: "reading" });
  });

  it("rejects message text, unknown fields and invalid numbers", () => {
    for (const invalid of [
      { ...view, sessions: [{ ...session, transcript: "text" }] },
      { ...view, sessions: [{ ...session, turns: -1 }] },
      { ...view, sessions: [{ ...session, usage: { totalTokens: 1, estimatedCostUsd: -1 } }] },
      { ...view, sessions: [{ ...session, nativeSessionId: " " }] },
      { ...view, sessions: [{ ...session, resumeCommand: "claude --resume x; rm -rf ~" }] },
      { ...view, sessions: [{ ...session, resumeCommand: "claude --resume $(x)" }] },
      { ...view, extra: true },
    ]) {
      expect(localSessionsQueryResultSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
