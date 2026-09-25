import { describe, expect, it } from "vitest";
import { localUsageQueryResultSchema } from "@codexhost/shared-contracts";

import { formatUsageTokens, renderLocalUsage } from "../../src/settings/usage-dashboard.js";
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
  hidden = false;
  constructor(readonly tagName: string) {}
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
function render(result: unknown): FakeElement {
  return renderLocalUsage(
    document,
    localUsageQueryResultSchema.parse(result),
    messages,
  ) as unknown as FakeElement;
}

const result = {
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
  models: 3,
  harnesses: [
    { harnessId: "claude-code", name: "Claude Code", totalTokens: 1_000_000, models: 2 },
    { harnessId: "pi", name: "Pi", totalTokens: 234_567, models: 1 },
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

  it("shows the range total, Harness shares, cards and newest-first daily rows", () => {
    const root = render(result);
    const total = all(root).find((element) => element.dataset.usageTotal !== undefined);
    expect(total?.textContent).toBe("1.23M");
    expect(total?.title).toBe((1_234_567).toLocaleString());
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
});
