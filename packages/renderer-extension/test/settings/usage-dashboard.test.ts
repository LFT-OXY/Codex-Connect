import { describe, expect, it } from "vitest";
import { localUsageViewSchema } from "@codexhost/shared-contracts";

import {
  formatUsageCost,
  formatUsageShare,
  formatUsageTokens,
  renderLocalUsage,
} from "../../src/settings/usage-dashboard.js";
import { rendererSettingsMessages } from "../../src/settings/localization.js";

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  className = "";
  textContent = "";
  title = "";
  scope = "";
  type = "";
  id = "";
  tabIndex = 0;
  hidden = false;
  focused = false;
  readonly listeners = new Map<
    string,
    (event: { key?: string | undefined; preventDefault(): void }) => void
  >();
  constructor(readonly tagName: string) {}
  addEventListener(
    name: string,
    listener: (event: { key?: string | undefined; preventDefault(): void }) => void,
  ): void {
    this.listeners.set(name, listener);
  }
  fire(name: string, key?: string): void {
    this.listeners.get(name)?.({ key, preventDefault() {} });
  }
  focus(): void {
    this.focused = true;
  }
  append(...children: (FakeElement | string)[]): void {
    for (const child of children) {
      if (typeof child === "string") {
        const text = new FakeElement("#text");
        text.textContent = child;
        this.children.push(text);
      } else this.children.push(child);
    }
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

const document = {
  createElement: (tagName: string) => new FakeElement(tagName),
} as unknown as Document;
const messages = rendererSettingsMessages("zh-CN");

function all(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap(all)];
}
function text(root: FakeElement): string {
  return all(root)
    .map((element) => element.textContent)
    .filter(Boolean)
    .join(" ");
}
function render(result: unknown, tab?: Parameters<typeof renderLocalUsage>[3]): FakeElement {
  return renderLocalUsage(
    document,
    localUsageViewSchema.parse(result),
    messages,
    tab,
  ) as unknown as FakeElement;
}

const result = {
  status: "ready",
  range: { from: "2026-03-02", to: "2026-03-08" },
  totals: {
    total: 1_234_567,
    input: 1_000,
    cacheRead: 1_200_000,
    cacheWrite: 30_000,
    output: 3_567,
    reasoning: 0,
    conversations: 12,
  },
  estimatedCostUsd: 1234.567,
  models: 3,
  harnesses: [
    {
      harnessId: "claude-code",
      name: "Claude Code",
      totalTokens: 1_000_000,
      models: 2,
      providers: [],
    },
    {
      harnessId: "pi",
      name: "Pi",
      totalTokens: 234_567,
      models: 2,
      providers: [
        { provider: "openai-codex", totalTokens: 234_560, models: 1 },
        { provider: "anthropic", totalTokens: 7, models: 1 },
      ],
    },
  ],
  daily: [
    {
      date: "2026-03-03",
      total: 1_000_000,
      input: 500,
      output: 1_500,
      cacheRead: 990_000,
      reasoning: 0,
      conversations: 5,
    },
    {
      date: "2026-03-02",
      total: 234_567,
      input: 500,
      output: 2_067,
      cacheRead: 210_000,
      reasoning: 0,
      conversations: 7,
    },
  ],
  projects: [
    { project: "acme/widget", totalTokens: 1_000_000, harnessIds: ["claude-code", "pi"] },
    { project: "scratch", totalTokens: 250_000, harnessIds: ["pi"] },
  ],
  failures: [],
  stats: {
    last7Days: 1_234_567,
    last30Days: 45_678_901,
    dailyAverage: 2_283_945,
    activeDays: 128,
    firstActiveDate: "2025-06-01",
  },
};

describe("Local Usage dashboard", () => {
  it("abbreviates large token counts with K, M and B", () => {
    expect(formatUsageTokens(0)).toBe("0");
    expect(formatUsageTokens(999)).toBe("999");
    expect(formatUsageTokens(12_345)).toBe("12.35K");
    expect(formatUsageTokens(999_999)).toBe("1M");
    expect(formatUsageTokens(999_999_999_999)).toBe("1000B");
    expect(formatUsageTokens(1_000_004)).toBe("1M");
    expect(formatUsageTokens(6_035_507_564)).toBe("6.04B");
  });

  it("formats Estimated Cost in US dollars with cents", () => {
    expect(formatUsageCost(0)).toBe("$0.00");
    expect(formatUsageCost(0.004)).toBe("<$0.01");
    expect(formatUsageCost(0.005)).toBe("$0.01");
    expect(formatUsageCost(1234.567)).toBe("$1,234.57");
  });

  it("shows the range total, Harness shares, cards and newest-first daily rows", () => {
    const root = render(result);
    const total = all(root).find((element) => element.dataset.usageTotal !== undefined);
    expect(total?.textContent).toBe("1.23M");
    expect(total?.title).toBe((1_234_567).toLocaleString());
    // The cost sits directly below the total, above the range dates, with no pricing caveat.
    const summary = all(root).find((element) => element.children.includes(total as FakeElement));
    expect(summary?.children.map((element) => element.textContent)).toEqual([
      "Token 总数",
      "1.23M",
      "$1,234.57",
      "2026-03-02 – 2026-03-08",
    ]);
    expect(summary?.children[2]?.dataset.usageCost).toBe("");
    expect(text(root)).toContain("Token 总数");
    expect(text(root)).toContain("2026-03-02 – 2026-03-08");

    const segments = all(root).filter((element) => element.dataset.usageSegment !== undefined);
    expect(segments.map((element) => element.dataset.usageSegment)).toEqual(["claude-code", "pi"]);
    expect(segments[0]?.style.width).toBe(`${(1_000_000 / 1_234_567) * 100}%`);

    const cards = all(root).filter((element) => element.dataset.usageHarnessCard !== undefined);
    expect(cards.map((card) => card.dataset.usageHarnessCard)).toEqual([
      "all",
      "claude-code",
      "pi",
    ]);
    const [all_, claude] = cards.map(text);
    expect(all_).toContain("全部");
    expect(all_).toContain("100%");
    expect(all_).toContain("3 个模型");
    expect(claude).toContain("Claude Code");
    expect(claude).toContain("81.00%");
    expect(claude).toContain("2 个模型");
    expect(segments[1]?.title).toBe("Pi 19.00%");

    const headers = all(root).filter((element) => element.tagName === "th");
    expect(headers.map((header) => header.textContent)).toEqual([
      "日期",
      "总计",
      "输入",
      "输出",
      "缓存",
      "推理",
      "对话数",
    ]);
    const rows = all(root).filter((element) => element.dataset.usageDay !== undefined);
    expect(rows.map((row) => row.dataset.usageDay)).toEqual(["2026-03-03", "2026-03-02"]);
    expect(rows[1]?.children.map((cell) => cell.textContent)).toEqual([
      "2026-03-02",
      "234.57K",
      "500",
      "2.07K",
      "210K",
      "0",
      "7",
    ]);
  });

  it("formats shares with two decimals without showing a used Harness as zero", () => {
    expect(formatUsageShare(0)).toBe("0.00%");
    expect(formatUsageShare(0.004)).toBe("<0.01%");
    expect(formatUsageShare(0.005)).toBe("0.01%");
    expect(formatUsageShare(81)).toBe("81.00%");
  });

  it("expands a Harness card into its Providers' shares of that Harness", () => {
    const root = render({
      ...result,
      harnesses: [
        ...result.harnesses,
        { harnessId: "codex", name: "Codex", totalTokens: 1, models: 1, providers: [] },
      ],
    });
    const cards = all(root).filter((element) => element.dataset.usageHarnessCard !== undefined);
    const card = (id: string) =>
      cards.find((element) => element.dataset.usageHarnessCard === id) as FakeElement;
    expect(text(card("codex"))).toContain("<0.01%");

    // Harnesses that record no Provider have nothing to expand.
    const breakdowns = all(root).filter((element) => element.dataset.usageProviders !== undefined);
    expect(breakdowns.map((element) => element.dataset.usageProviders)).toEqual(["pi"]);
    const [details] = breakdowns;
    expect(details?.tagName).toBe("details");
    expect(all(card("pi"))).toContain(details);
    expect(details?.children[0]?.tagName).toBe("summary");
    expect(details?.children[0]?.textContent).toBe("Provider（2）");
    const rows = all(details as FakeElement).filter(
      (element) => element.dataset.usageProvider !== undefined,
    );
    expect(rows.map(text)).toEqual(["openai-codex 100.00% 1 个模型", "anthropic <0.01% 1 个模型"]);
  });

  it("shows rolling totals, the daily average, range conversations and usage history", () => {
    const root = render(result);
    const tiles = all(root).filter((element) => element.dataset.usageStat !== undefined);
    expect(tiles.map((tile) => tile.dataset.usageStat)).toEqual([
      "last7Days",
      "last30Days",
      "dailyAverage",
      "conversations",
    ]);
    expect(tiles.map(text)).toEqual([
      "1.23M 最近 7 天",
      "45.68M 最近 30 天",
      "2.28M 日均",
      "12 对话数",
    ]);
    expect(tiles[1]?.children[0]?.title).toBe((45_678_901).toLocaleString());
    const history = all(root).find((element) => element.dataset.usageHistory !== undefined);
    expect(text(history as FakeElement)).toBe("开始使用 2025-06-01 活跃天数 128 天");
    // Stat blocks sit between the Harness cards and the daily table.
    const order = all(root)
      .filter(
        (element) =>
          element.dataset.usageHarnessCard === "all" ||
          element.dataset.usageStat === "last7Days" ||
          element.tagName === "table",
      )
      .map((element) => element.tagName);
    expect(order).toEqual(["div", "div", "table"]);
  });

  it("keeps stat blocks for an empty range and omits them without any history", () => {
    const empty = {
      ...result,
      totals: {
        ...result.totals,
        total: 0,
        input: 0,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        conversations: 0,
      },
      models: 0,
      harnesses: [],
      daily: [],
    };
    const withHistory = render(empty);
    expect(text(withHistory)).toContain("该周期内没有用量。");
    expect(
      all(withHistory)
        .filter((element) => element.dataset.usageStat !== undefined)
        .map(text),
    ).toContain("0 对话数");

    const noHistory = render({
      ...empty,
      stats: { last7Days: 0, last30Days: 0, dailyAverage: 0, activeDays: 0, firstActiveDate: null },
    });
    expect(all(noHistory).some((element) => element.dataset.usageStat !== undefined)).toBe(false);
    expect(all(noHistory).some((element) => element.dataset.usageHistory !== undefined)).toBe(
      false,
    );
  });

  it("shows an empty state instead of cards and rows when the range has no usage", () => {
    const root = render({
      ...result,
      totals: {
        ...result.totals,
        total: 0,
        input: 0,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        conversations: 0,
      },
      models: 0,
      harnesses: [],
      daily: [],
    });
    expect(text(root)).toContain("该周期内没有用量。");
    expect(all(root).some((element) => element.dataset.usageHarnessCard !== undefined)).toBe(false);
    expect(all(root).some((element) => element.tagName === "table")).toBe(false);
  });

  it("switches the details between the daily breakdown and projects, keeping the page's choice", () => {
    const selected: string[] = [];
    const root = render(result, { selected: "daily", select: (tab) => selected.push(tab) });
    const tabs = all(root).filter((element) => element.dataset.usageTab !== undefined);
    expect(tabs.map((tab) => [tab.dataset.usageTab, tab.textContent])).toEqual([
      ["daily", "每日明细"],
      ["projects", "项目用量"],
    ]);
    expect(tabs.map((tab) => tab.attributes.get("aria-selected"))).toEqual(["true", "false"]);
    const panel = (id: string) =>
      all(root).find((element) => element.dataset.usageTabPanel === id) as FakeElement;
    expect(panel("daily").hidden).toBe(false);
    expect(panel("projects").hidden).toBe(true);

    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    expect(tabs.map((tab) => tab.attributes.get("aria-controls"))).toEqual([
      panel("daily").id,
      panel("projects").id,
    ]);
    tabs[1]?.fire("click");
    expect(selected).toEqual(["projects"]);
    expect(panel("daily").hidden).toBe(true);
    expect(panel("projects").hidden).toBe(false);
    expect(tabs[1]?.attributes.get("aria-selected")).toBe("true");
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);
    // Arrow keys move to the other tab and focus it.
    tabs[1]?.fire("keydown", "ArrowRight");
    expect(selected).toEqual(["projects", "daily"]);
    expect(panel("daily").hidden).toBe(false);
    expect(tabs[0]?.focused).toBe(true);
    tabs[0]?.fire("keydown", "Enter");
    expect(selected).toHaveLength(2);

    const rows = all(panel("projects")).filter(
      (element) => element.dataset.usageProject !== undefined,
    );
    expect(rows.map(text)).toEqual(["acme/ widget Claude Code · Pi 1M", "scratch Pi 250K"]);
    const fills = rows.map(
      (row) => all(row).find((element) => element.style.width !== undefined)?.style.width,
    );
    expect(fills).toEqual(["100%", "25%"]);

    // A later result opens on the tab the page remembered.
    const reopened = render(result, { selected: "projects", select() {} });
    expect(all(reopened).find((element) => element.dataset.usageTabPanel === "daily")?.hidden).toBe(
      true,
    );
  });

  it("says when a range has usage but none with a project", () => {
    const root = render({ ...result, projects: [] }, { selected: "projects", select() {} });
    const panel = all(root).find((element) => element.dataset.usageTabPanel === "projects");
    expect(text(panel as FakeElement)).toBe("该周期内没有项目用量。");
  });

  it("names each Harness whose records could not be read above the numbers", () => {
    const root = render({ ...result, failures: [{ harnessId: "pi", name: "Pi" }] });
    const notices = all(root).filter((element) => element.dataset.usageFailure !== undefined);
    expect(notices.map((notice) => [notice.dataset.usageFailure, notice.textContent])).toEqual([
      ["pi", "无法读取 Pi 的用量记录，其数字来自上次成功读取。"],
    ]);
    expect(notices[0]?.attributes.get("role")).toBe("alert");
    expect(root.children[0]).toBe(notices[0]);
    // The failed Harness keeps its earlier numbers on screen.
    expect(all(root).some((element) => element.dataset.usageHarnessCard === "pi")).toBe(true);
  });
});
