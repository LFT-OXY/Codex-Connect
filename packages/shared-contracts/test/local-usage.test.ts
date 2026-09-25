import { describe, expect, it } from "vitest";
import {
  LOCAL_USAGE_CUSTOM_RANGE_MAX_DAYS,
  LOCAL_USAGE_QUERY_METHOD,
  localUsageQueryParamsSchema,
  localUsageQueryResultSchema,
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
      range: { from: "2026-03-01", to: "2026-03-07" },
      totals: { ...tokens, conversations: 2 },
      models: 1,
      harnesses: [{ harnessId: "claude-code", name: "Claude Code", totalTokens: 10, models: 1 }],
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
    };
    expect(localUsageQueryResultSchema.parse(result)).toEqual(result);
    expect(
      localUsageQueryResultSchema.safeParse({
        ...result,
        totals: { ...result.totals, total: 11 },
      }).success,
    ).toBe(false);
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
});
