import { describe, expect, it } from "vitest";

import {
  accountUsagePace,
  accountUsageWindowRows,
} from "../../src/settings/accounts-usage-windows.js";
import { rendererSettingsMessages } from "../../src/settings/localization.js";

const messages = rendererSettingsMessages("zh-CN");
const HOUR = 3_600_000;

describe("Account usage window rows", () => {
  it("projects the primary window and product usage into one row each", () => {
    expect(
      accountUsageWindowRows(
        {
          usedPercent: 40,
          periodType: "five_hour",
          resetsAt: "2026-09-10T10:00:00.000Z",
          productUsage: [
            { product: "7-day window", usagePercent: 12, resetsAt: "2026-09-14T00:00:00.000Z" },
          ],
        },
        messages,
      ),
    ).toEqual([
      {
        label: "5 小时",
        usedPercent: 40,
        resetsAt: "2026-09-10T10:00:00.000Z",
        windowMs: 5 * HOUR,
      },
      {
        label: "7 天",
        usedPercent: 12,
        resetsAt: "2026-09-14T00:00:00.000Z",
        windowMs: 7 * 24 * HOUR,
      },
    ]);
  });

  it("gives model-scoped windows a named row and a length only when the source names the period", () => {
    const rows = accountUsageWindowRows(
      {
        label: "Fable · 7-day",
        usedPercent: 30,
        periodType: "seven_day",
        productUsage: [
          { product: "Gemini Models · 5-hour window", usagePercent: 5 },
          { product: "Gemini Models · Weekly window", usagePercent: 8 },
          { product: "Gemini Models · daily window", usagePercent: 9 },
        ],
      },
      messages,
    );
    expect(rows.map(({ label, windowMs }) => [label, windowMs])).toEqual([
      ["Fable · 7 天", 7 * 24 * HOUR],
      ["Gemini Models · 5 小时", 5 * HOUR],
      ["Gemini Models · 周额度", 7 * 24 * HOUR],
      ["Gemini Models · daily window", undefined],
    ]);
  });

  it("keeps monthly, unknown, and product windows without a length and names Grok products", () => {
    const rows = accountUsageWindowRows(
      {
        usedPercent: 20,
        periodType: "monthly",
        resetsAt: "2026-10-01T00:00:00.000Z",
        productUsage: [
          { product: "GrokBuild", usagePercent: 3 },
          { product: "GrokChat", usagePercent: 0 },
        ],
      },
      messages,
    );
    expect(rows).toEqual([
      { label: "月额度", usedPercent: 20, resetsAt: "2026-10-01T00:00:00.000Z" },
      { label: "Build", usedPercent: 3 },
      { label: "Chat", usedPercent: 0 },
    ]);
    expect(accountUsageWindowRows({ usedPercent: 1, periodType: "unknown" }, messages)).toEqual([
      { label: "额度", usedPercent: 1 },
    ]);
  });

  it("keeps account-wide windows first and each model group together, without merging duplicates", () => {
    const rows = accountUsageWindowRows(
      {
        label: "Gemini · 5-hour window",
        usedPercent: 10,
        periodType: "five_hour",
        productUsage: [
          { product: "Claude · 5-hour window", usagePercent: 20 },
          { product: "7-day window", usagePercent: 30 },
          { product: "Claude · Weekly window", usagePercent: 40 },
          { product: "Gemini · Weekly window", usagePercent: 50 },
          { product: "7-day window", usagePercent: 60 },
        ],
      },
      messages,
    );
    expect(rows.map(({ label, usedPercent }) => `${label} ${usedPercent}`)).toEqual([
      "7 天 30",
      "7 天 60",
      "Gemini · 5 小时 10",
      "Gemini · 周额度 50",
      "Claude · 5 小时 20",
      "Claude · 周额度 40",
    ]);
  });

  it("keeps only 7-day windows for a weekly-only account and never pads the result", () => {
    const credits = {
      usedPercent: 40,
      periodType: "five_hour" as const,
      productUsage: [{ product: "7-day window", usagePercent: 12 }],
    };
    expect(
      accountUsageWindowRows(credits, messages, "weekly-only").map(({ label }) => label),
    ).toEqual(["7 天"]);
    expect(
      accountUsageWindowRows({ usedPercent: 40, periodType: "five_hour" }, messages, "weekly-only"),
    ).toEqual([]);
  });
});

describe("Account usage pace marker", () => {
  const now = Date.UTC(2026, 8, 10, 12, 0);
  // A 5-hour window resetting in 3 hours is 40% elapsed.
  const window = {
    label: "5 小时",
    usedPercent: 43,
    resetsAt: new Date(now + 3 * HOUR).toISOString(),
    windowMs: 5 * HOUR,
  };

  it("places the marker at the elapsed share of the window", () => {
    expect(accountUsagePace(window, "used", now)).toEqual({ position: 40, ahead: false });
  });

  it("warns only when use runs more than 3 points ahead of pace", () => {
    expect(accountUsagePace({ ...window, usedPercent: 43 }, "used", now)?.ahead).toBe(false);
    expect(accountUsagePace({ ...window, usedPercent: 43.5 }, "used", now)?.ahead).toBe(true);
    expect(accountUsagePace({ ...window, usedPercent: 10 }, "used", now)?.ahead).toBe(false);
  });

  it("stays hidden for light use or when the window length or reset time is unknown", () => {
    expect(accountUsagePace({ ...window, usedPercent: 4.9 }, "used", now)).toBeNull();
    expect(accountUsagePace({ ...window, usedPercent: 5 }, "used", now)).not.toBeNull();
    const { usedPercent, resetsAt, windowMs } = window;
    expect(accountUsagePace({ usedPercent, resetsAt }, "used", now)).toBeNull();
    expect(accountUsagePace({ usedPercent, windowMs }, "used", now)).toBeNull();
    expect(accountUsagePace({ ...window, resetsAt: "not-a-date" }, "used", now)).toBeNull();
  });

  it("mirrors the marker for the remaining view while judging pace by used share", () => {
    expect(accountUsagePace({ ...window, usedPercent: 50 }, "remaining", now)).toEqual({
      position: 60,
      ahead: true,
    });
  });

  it("clamps the marker once the reset time has passed or the window has not started", () => {
    const passed = { ...window, resetsAt: new Date(now - HOUR).toISOString() };
    expect(accountUsagePace(passed, "used", now)?.position).toBe(100);
    const early = { ...window, resetsAt: new Date(now + 6 * HOUR).toISOString() };
    expect(accountUsagePace(early, "used", now)?.position).toBe(0);
  });
});
