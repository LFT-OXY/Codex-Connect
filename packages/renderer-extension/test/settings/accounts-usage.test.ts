import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountCreditsSnapshot } from "@codexhost/shared-contracts";

vi.mock("../../src/settings/icons.js", () => ({
  createRendererSettingsIcon: () => "icon",
}));

import {
  renderAccountResetCredits,
  renderAccountUsage,
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

describe("Account reset cards", () => {
  const now = Date.parse("2026-09-10T12:00:00.000Z");
  const hours = (value: number) => new Date(now + value * 3_600_000).toISOString();
  const resetCards = (resetCredits: AccountCreditsSnapshot["resetCredits"]) =>
    renderAccountResetCredits(document, { ...credits, resetCredits }, messages, now);
  const rows = (root: HTMLElement | null) =>
    root ? elements(root).filter((el) => el.dataset.resetCredit !== undefined) : [];
  const meter = (row: FakeElement | undefined) =>
    row?.children.find(
      (child): child is FakeElement =>
        child instanceof FakeElement && child.attributes.get("role") === "meter",
    );

  it("does not render the area or invent a zero count without reset cards", () => {
    expect(renderAccountResetCredits(document, credits, messages, now)).toBeNull();
  });

  it("draws each card's remaining lifetime and its local expiry", () => {
    const result = resetCards({
      availableCount: 2,
      credits: [
        { expiresAt: hours(24 * 3), grantedAt: hours(-24) },
        { expiresAt: hours(24 * 7), grantedAt: hours(-24 * 3) },
      ],
    });
    if (!result) throw new Error("Expected reset cards");
    const [first, second] = rows(result);
    if (!first || !second) throw new Error("Expected two reset cards");
    expect(rows(result)).toHaveLength(2);
    expect(text(first)).toContain("重置 1");
    expect(text(second)).toContain("重置 2");
    expect(meter(first)?.attributes.get("aria-valuenow")).toBe("75");
    expect((meter(first)?.children[0] as FakeElement).style.width).toBe("75%");
    expect(meter(second)?.attributes.get("aria-valuenow")).toBe("70");
    const expiry = elements(first as unknown as HTMLElement).find((el) => el.tagName === "time");
    expect(expiry?.dateTime).toBe(hours(24 * 3));
    expect(expiry?.textContent).toMatch(/9月13日/u);
    expect(expiry?.title).toContain("第 1 张");
    expect(expiry?.title).toContain("2026");
    expect(expiry?.title.endsWith("到期")).toBe(true);
    expect(elements(result).some((el) => el.tagName === "button")).toBe(false);
  });

  it("shows only the expiry when the grant time is missing or unusable", () => {
    const result = resetCards({
      availableCount: 3,
      credits: [
        { expiresAt: hours(48) },
        { expiresAt: hours(48), grantedAt: hours(48) },
        { expiresAt: hours(48), grantedAt: "not-a-date" },
      ],
    });
    expect(rows(result)).toHaveLength(3);
    for (const row of rows(result)) {
      expect(meter(row)).toBeUndefined();
      expect(row.children.some((child) => (child as FakeElement).tagName === "time")).toBe(true);
    }
  });

  it("falls back to the legacy expiry list without drawing lifetimes", () => {
    const result = resetCards({ availableCount: 2, expiresAt: [hours(30), hours(60)] });
    expect(rows(result)).toHaveLength(2);
    expect(rows(result).some((row) => meter(row))).toBe(false);
  });

  it("keeps lifetimes within the bar for expired or future-granted cards", () => {
    const result = resetCards({
      availableCount: 2,
      credits: [
        { expiresAt: hours(-1), grantedAt: hours(-48) },
        { expiresAt: hours(48), grantedAt: hours(1) },
      ],
    });
    expect(rows(result).map((row) => meter(row)?.attributes.get("aria-valuenow"))).toEqual([
      "0",
      "100",
    ]);
  });

  it("shows the reported count without per-card rows when details are absent", () => {
    const result = resetCards({ availableCount: 2 });
    if (!result) throw new Error("Expected reset cards");
    expect(text(result)).toContain("2 张");
    expect(rows(result)).toHaveLength(0);
  });

  it("warns as a card nears expiry", () => {
    const result = resetCards({
      availableCount: 3,
      credits: [{ expiresAt: hours(4) }, { expiresAt: hours(20) }, { expiresAt: hours(30) }],
    });
    expect(rows(result).map((row) => row.dataset.tone)).toEqual(["hot", "warn", "ok"]);
  });
});
