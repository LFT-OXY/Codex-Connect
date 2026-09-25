import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountCreditsSnapshot } from "@codexhost/shared-contracts";

vi.mock("../../src/settings/icons.js", () => ({
  createRendererSettingsIcon: () => "icon",
}));

import {
  renderAccountResetCredits,
  renderAccountUsage,
  resetCreditDetailLine,
} from "../../src/settings/accounts-usage.js";
import { rendererSettingsMessages } from "../../src/settings/localization.js";

class FakeElement {
  readonly children: unknown[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly listeners = new Map<string, () => void>();
  className = "";
  textContent = "";
  title = "";
  type = "";
  hidden = false;
  disabled = false;
  dateTime = "";
  constructor(readonly tagName: string) {}
  addEventListener(name: string, listener: () => void): void {
    this.listeners.set(name, listener);
  }
  append(...children: unknown[]): void {
    this.children.push(...children);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

const document = {
  createElement: (tagName: string) => new FakeElement(tagName),
} as unknown as Document;
const messages = rendererSettingsMessages("zh-CN");
function descendants(root: FakeElement): FakeElement[] {
  return [
    root,
    ...root.children.flatMap((child) => (child instanceof FakeElement ? descendants(child) : [])),
  ];
}
function elements(root: HTMLElement): FakeElement[] {
  return descendants(root as unknown as FakeElement);
}
function text(root: HTMLElement | FakeElement): string {
  return descendants(root as FakeElement)
    .map((el) => el.textContent)
    .join(" ");
}
const credits = {
  usedPercent: 91,
  periodType: "five_hour" as const,
  resetsAt: "2026-09-10T03:12:00.000Z",
};

function usage(snapshot: AccountCreditsSnapshot = credits, display: "used" | "remaining" = "used") {
  return renderAccountUsage(
    document,
    { status: "ready", credits: snapshot, freshness: "live", observedAt: null },
    messages,
    display,
    vi.fn(),
  );
}
function windows(root: HTMLElement): FakeElement[] {
  return elements(root).filter((el) => el.dataset.usageWindow !== undefined);
}
function meters(root: HTMLElement): FakeElement[] {
  return elements(root).filter((el) => el.attributes.get("role") === "meter");
}

describe("Account limit windows", () => {
  it("renders one bar row per reported window and never synthesizes a missing one", () => {
    const result = usage({ usedPercent: 9, periodType: "seven_day" });
    expect(windows(result)).toHaveLength(1);
    expect(text(result)).toContain("7 天");
    expect(text(result)).not.toContain("5 小时");
    expect(text(result)).not.toContain("—");
  });

  it("preserves primary and product windows without summing or deduplicating them", () => {
    const result = usage({
      ...credits,
      productUsage: [
        { product: "7-day window", usagePercent: 0 },
        { product: "7-day window", usagePercent: 35 },
        { product: "GPT-5.3-Codex-Spark", usagePercent: 25 },
      ],
    });
    expect(meters(result).map((el) => el.attributes.get("aria-valuenow"))).toEqual([
      "91",
      "0",
      "35",
      "25",
    ]);
    expect(windows(result).map((row) => text(row.children[0] as FakeElement))).toEqual([
      "5 小时",
      "7 天",
      "7 天",
      "GPT-5.3-Codex-Spark",
    ]);
  });

  it("switches bar and number to the remaining view while tone follows used share", () => {
    const result = usage(credits, "remaining");
    const [row] = windows(result);
    expect(text(result)).toContain("9%");
    const [meter] = meters(result);
    expect(meter?.attributes.get("aria-valuenow")).toBe("9");
    expect(meter?.attributes.get("aria-label")).toBe("5 小时 · 剩余");
    expect(row?.dataset.tone).toBe("hot");
    expect((meter?.children[0] as FakeElement).style.width).toBe("9%");
    expect(windows(usage({ ...credits, usedPercent: 70 }, "remaining"))[0]?.dataset.tone).toBe(
      "warn",
    );
    expect(windows(usage({ ...credits, usedPercent: 69 }))[0]?.dataset.tone).toBe("ok");
  });

  it.each([0, 100])("renders the %i percent boundary in either display mode", (usedPercent) => {
    for (const display of ["used", "remaining"] as const) {
      const [meter] = meters(usage({ ...credits, usedPercent }, display));
      expect(meter?.attributes.get("aria-valuenow")).toBe(
        String(display === "used" ? usedPercent : 100 - usedPercent),
      );
    }
  });

  it("keeps unavailable, loading, empty, and failed states distinct from zero usage", () => {
    expect(meters(renderAccountUsage(document, undefined, messages, "used", vi.fn()))).toHaveLength(
      0,
    );
    for (const status of ["loading", "empty", "error"] as const) {
      const retry = vi.fn();
      const result = renderAccountUsage(document, { status }, messages, "used", retry);
      expect(meters(result)).toHaveLength(0);
      if (status === "error") {
        elements(result)
          .find((el) => el.tagName === "button")
          ?.listeners.get("click")?.();
        expect(retry).toHaveBeenCalledOnce();
      } else expect(elements(result).some((el) => el.tagName === "button")).toBe(false);
      if (status === "loading")
        expect(elements(result).some((el) => el.attributes.get("aria-busy") === "true")).toBe(true);
    }
  });

  it("shows only 7-day windows for a weekly-only account", () => {
    const result = renderAccountUsage(
      document,
      {
        status: "ready",
        credits: { ...credits, productUsage: [{ product: "7-day window", usagePercent: 4 }] },
        freshness: "live",
        observedAt: null,
      },
      messages,
      "used",
      vi.fn(),
      "weekly-only",
    );
    expect(meters(result).map((el) => el.attributes.get("aria-valuenow"))).toEqual(["4"]);
  });
});

describe("Account limit pace and reset time", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  // Resetting in 3h: a 5-hour window is 40% elapsed.
  const paced = (usedPercent: number) => ({
    usedPercent,
    periodType: "five_hour" as const,
    resetsAt: "2026-09-10T15:00:00.000Z",
  });
  function marker(root: HTMLElement): FakeElement | undefined {
    return elements(root).find((el) => el.dataset.paceMarker !== undefined);
  }

  it("draws the pace marker at the even-use position, warning only when well ahead", () => {
    const even = usage(paced(42));
    expect(marker(even)?.hidden).toBe(false);
    expect(marker(even)?.style.left).toBe("40%");
    expect(marker(even)?.dataset.state).toBe("even");
    expect(meters(even)[0]?.title).toContain("40%");
    expect(marker(usage(paced(44)))?.dataset.state).toBe("ahead");
    expect(meters(usage(paced(44)))[0]?.title).toBe(
      "匀速使用时，此刻约应已用 40%，当前用得比匀速快",
    );
  });

  it("mirrors the marker for the remaining view", () => {
    expect(marker(usage(paced(42), "remaining"))?.style.left).toBe("60%");
  });

  it("hides the marker for light use and for windows without a known length", () => {
    expect(marker(usage(paced(4)))?.hidden ?? true).toBe(true);
    expect(marker(usage({ ...paced(50), periodType: "monthly" }))?.hidden ?? true).toBe(true);
  });

  it("shows a compact countdown whose hover reveals the full local reset time", () => {
    const countdown = elements(usage(paced(42))).find((el) => el.dataset.resetsAt);
    expect(countdown?.textContent).toBe("3h");
    expect(countdown?.title).toContain("距重置还有 3小时");
    expect(countdown?.title).toContain("2026");
    expect(countdown?.attributes.get("aria-label")).toBe(countdown?.title);
    expect(
      elements(usage({ usedPercent: 50, periodType: "five_hour" })).some(
        (el) => el.dataset.resetsAt,
      ),
    ).toBe(false);
  });

  it("marks an elapsed reset as awaiting refresh rather than resetting the bar", () => {
    const result = usage({ ...paced(80), resetsAt: "2026-09-10T11:00:00.000Z" });
    expect(elements(result).find((el) => el.dataset.resetsAt)?.textContent).toBe("待刷新");
    expect(meters(result)[0]?.attributes.get("aria-valuenow")).toBe("80");
  });
});

describe("Account reset-card details", () => {
  it("formats each available card's expiry", () => {
    const now = new Date(2026, 8, 10, 12, 0, 0);
    const expires = new Date(2026, 8, 10, 16, 12, 0);
    const line = resetCreditDetailLine(1, expires.toISOString(), messages, now);
    expect(line.startsWith("第 1 张 · ")).toBe(true);
    expect(line).toContain("今天");
    expect(line.endsWith("到期")).toBe(true);
  });

  it("does not invent a zero card count when no reset snapshot is provided", () => {
    expect(renderAccountResetCredits(document, credits, messages)).toBeNull();
  });

  it("shows only a count without per-card expiry data", () => {
    const result = renderAccountResetCredits(
      document,
      { ...credits, resetCredits: { availableCount: 2 } },
      messages,
    );
    if (!result) throw new Error("Expected reset details");
    expect(text(result.summary)).toContain("2 张");
    expect(elements(result.details).some((el) => el.tagName === "ul")).toBe(false);
    expect(elements(result.details).some((el) => el.tagName === "button")).toBe(false);
  });

  it("renders every expiry without a consume action", () => {
    const expiresAt = ["2026-09-10T16:12:00.000Z", "2026-09-18T08:00:00.000Z"];
    const result = renderAccountResetCredits(
      document,
      { ...credits, resetCredits: { availableCount: 2, nextExpiresAt: expiresAt[0], expiresAt } },
      messages,
    );
    if (!result) throw new Error("Expected reset details");
    expect(elements(result.details).filter((el) => el.tagName === "li")).toHaveLength(2);
    expect(text(result.details)).toContain("第 1 张");
    expect(text(result.details)).toContain("第 2 张");
    expect(elements(result.details).some((el) => el.tagName === "button")).toBe(false);
  });
});
