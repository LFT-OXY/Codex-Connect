import { describe, expect, it } from "vitest";
import {
  LOCAL_USAGE_CUSTOM_RANGE_MAX_DAYS,
  LOCAL_USAGE_QUERY_METHOD,
  localUsageQueryParamsSchema,
  localUsageQueryResultSchema,
  localUsageViewSchema,
} from "@codexhost/shared-contracts";

const tokens = { total: 10, input: 1, cacheRead: 2, cacheWrite: 3, output: 4, reasoning: 0 };

describe("Local Usage query contracts", () => {
  it("uses a codexhost method and accepts every period with an IANA time zone", () => {
    expect(LOCAL_USAGE_QUERY_METHOD).toBe("codexhost/usage/query");
    for (const kind of ["day", "week", "month", "total"] as const) {
      expect(
        localUsageQueryParamsSchema.parse({
          period: { kind },
          timeZone: "Asia/Shanghai",
          refresh: false,
        }),
      ).toEqual({ period: { kind }, timeZone: "Asia/Shanghai", refresh: false });
    }
    expect(
      localUsageQueryParamsSchema.parse({
        period: { kind: "custom", from: "2026-02-28", to: "2026-03-01" },
        timeZone: "UTC",
        refresh: true,
      }).period,
    ).toEqual({ kind: "custom", from: "2026-02-28", to: "2026-03-01" });
  });

  it("rejects unknown zones, impossible dates, reversed or unbounded custom ranges, and extra fields", () => {
    const base = { period: { kind: "day" }, timeZone: "UTC", refresh: false };
    for (const params of [
      { ...base, timeZone: "Mars/Olympus" },
      { ...base, timeZone: "" },
      { ...base, period: { kind: "year" } },
      { ...base, period: { kind: "custom", from: "2026-02-30", to: "2026-03-01" } },
      { ...base, period: { kind: "custom", from: "2026-3-1", to: "2026-03-01" } },
      { ...base, period: { kind: "custom", from: "2026-03-02", to: "2026-03-01" } },
      {
        ...base,
        period: {
          kind: "custom",
          from: "2000-01-01",
          to: new Date(Date.UTC(2000, 0, LOCAL_USAGE_CUSTOM_RANGE_MAX_DAYS + 1))
            .toISOString()
            .slice(0, 10),
        },
      },
      { ...base, period: { kind: "day", from: "2026-03-01" } },
      { ...base, extra: true },
      { period: base.period, timeZone: "UTC" },
    ]) {
      expect(localUsageQueryParamsSchema.safeParse(params).success).toBe(false);
    }
  });

  it("carries aggregate numbers only and keeps token totals consistent with their parts", () => {
    const result = {
      status: "ready",
      range: { from: "2026-03-01", to: "2026-03-07" },
      totals: { ...tokens, conversations: 2 },
      estimatedCostUsd: 0.125,
      models: 1,
      harnesses: [
        {
          harnessId: "claude-code",
          name: "Claude Code",
          totalTokens: 10,
          models: 1,
          providers: [],
        },
      ],
      daily: [
        {
          date: "2026-03-02",
          total: 10,
          input: 1,
          output: 4,
          cacheRead: 2,
          reasoning: 0,
          conversations: 2,
        },
      ],
      projects: [{ project: "acme/widget", totalTokens: 10, harnessIds: ["claude-code"] }],
      failures: [],
      stats: {
        last7Days: 10,
        last30Days: 10,
        dailyAverage: 10,
        activeDays: 1,
        firstActiveDate: "2026-03-02",
      },
    };
    expect(localUsageQueryResultSchema.parse(result)).toEqual(result);
    const noHistory = {
      ...result,
      stats: { last7Days: 0, last30Days: 0, dailyAverage: 0, activeDays: 0, firstActiveDate: null },
    };
    expect(localUsageQueryResultSchema.parse(noHistory)).toEqual(noHistory);
    for (const stats of [
      { ...result.stats, dailyAverage: 1.5 },
      { ...result.stats, firstActiveDate: "2026-02-30" },
      { ...result.stats, streak: 1 },
      { ...result.stats, firstActiveDate: null },
      { ...noHistory.stats, activeDays: 1 },
      { ...result.stats, last7Days: 11 },
    ]) {
      expect(localUsageQueryResultSchema.safeParse({ ...result, stats }).success).toBe(false);
    }
    expect(
      localUsageQueryResultSchema.safeParse({
        ...result,
        totals: { ...result.totals, total: 11 },
      }).success,
    ).toBe(false);
    // Official Codex is a usage source without a plugin identity.
    const codex = { harnessId: "codex", name: "Codex", totalTokens: 10, models: 1, providers: [] };
    expect(localUsageViewSchema.parse({ ...result, harnesses: [codex] }).harnesses).toEqual([
      codex,
    ]);
    for (const harnessId of ["", "Codex", "not a plugin id"]) {
      expect(
        localUsageQueryResultSchema.safeParse({ ...result, harnesses: [{ ...codex, harnessId }] })
          .success,
      ).toBe(false);
    }
    // Pi-like Harnesses break their share down by Provider.
    const pi = {
      harnessId: "pi",
      name: "Pi",
      totalTokens: 10,
      models: 2,
      providers: [
        { provider: "openai-codex", totalTokens: 9, models: 1 },
        { provider: "anthropic", totalTokens: 1, models: 1 },
      ],
    };
    expect(localUsageViewSchema.parse({ ...result, harnesses: [pi] }).harnesses).toEqual([pi]);
    for (const providers of [
      [{ provider: "openai-codex", totalTokens: 11, models: 1 }],
      [{ provider: "", totalTokens: 1, models: 1 }],
      [{ provider: "openai-codex", totalTokens: 1, models: 1, cwd: "/work" }],
      undefined,
    ]) {
      expect(
        localUsageQueryResultSchema.safeParse({ ...result, harnesses: [{ ...pi, providers }] })
          .success,
      ).toBe(false);
    }
    for (const estimatedCostUsd of [
      -0.01,
      Number.POSITIVE_INFINITY,
      Number.NaN,
      "0.1",
      undefined,
    ]) {
      expect(localUsageQueryResultSchema.safeParse({ ...result, estimatedCostUsd }).success).toBe(
        false,
      );
    }
    expect(
      localUsageQueryResultSchema.safeParse({
        ...result,
        daily: [{ ...result.daily[0], text: "never sent" }],
      }).success,
    ).toBe(false);
    expect(
      localUsageQueryResultSchema.safeParse({
        ...result,
        totals: { ...result.totals, input: -1, total: 8 },
      }).success,
    ).toBe(false);
  });

  it("lists projects and failed Harnesses by identity and name only", () => {
    const view = localUsageViewSchema.parse({
      status: "ready",
      range: { from: "2026-03-01", to: "2026-03-07" },
      totals: { ...tokens, conversations: 0 },
      estimatedCostUsd: 0,
      models: 0,
      harnesses: [],
      daily: [],
      projects: [],
      failures: [],
      stats: { last7Days: 0, last30Days: 0, dailyAverage: 0, activeDays: 0, firstActiveDate: null },
    });
    const project = { project: "acme/widget", totalTokens: 5, harnessIds: ["codex", "pi"] };
    expect(localUsageViewSchema.parse({ ...view, projects: [project] }).projects).toEqual([
      project,
    ]);
    for (const projects of [
      [{ ...project, project: "" }],
      [{ ...project, harnessIds: [] }],
      [{ ...project, harnessIds: ["Not An Id"] }],
      [{ ...project, cwd: "/work/widget" }],
      Array.from({ length: 1_001 }, () => project),
    ]) {
      expect(localUsageViewSchema.safeParse({ ...view, projects }).success).toBe(false);
    }
    const failure = { harnessId: "pi", name: "Pi" };
    expect(localUsageViewSchema.parse({ ...view, failures: [failure] }).failures).toEqual([
      failure,
    ]);
    for (const failures of [
      [{ harnessId: "pi", name: " " }],
      [{ ...failure, message: "EACCES /Users/me/.pi" }],
      undefined,
    ]) {
      expect(localUsageViewSchema.safeParse({ ...view, failures }).success).toBe(false);
    }
  });

  it("answers an unfinished read with file progress only", () => {
    const reading = { status: "reading", progress: { processed: 3, total: 10 } };
    expect(localUsageQueryResultSchema.parse(reading)).toEqual(reading);
    expect(
      localUsageQueryResultSchema.parse({
        status: "reading",
        progress: { processed: 0, total: 0 },
      }),
    ).toMatchObject({ status: "reading" });
    for (const progress of [
      { processed: 11, total: 10 },
      { processed: -1, total: 10 },
      { processed: 1.5, total: 10 },
      { processed: 1, total: 10, file: "session.jsonl" },
    ]) {
      expect(localUsageQueryResultSchema.safeParse({ status: "reading", progress }).success).toBe(
        false,
      );
    }
    expect(
      localUsageQueryResultSchema.safeParse({ ...reading, totals: { ...tokens, conversations: 0 } })
        .success,
    ).toBe(false);
  });
});
