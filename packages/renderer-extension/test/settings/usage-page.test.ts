import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalUsageQueryResult } from "@codexhost/shared-contracts";

vi.mock("../../src/settings/icons.js", () => ({
  createRendererSettingsIcon: () => "icon",
}));

import type {
  RendererSettingsAsyncHandlers,
  RendererSettingsPageMountContext,
} from "../../src/settings/core.js";
import { rendererSettingsMessages } from "../../src/settings/localization.js";
import {
  createUsageSettingsPage,
  type RendererUsageClient,
} from "../../src/settings/usage-page.js";
import { RendererMethodUnavailableError } from "../../src/renderer-request-sender.js";

class FakeElement {
  children: (FakeElement | string)[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly listeners = new Map<string, (event: { preventDefault(): void }) => void>();
  className = "";
  textContent = "";
  title = "";
  type = "";
  value = "";
  scope = "";
  hidden = false;
  disabled = false;
  constructor(
    readonly tagName: string,
    readonly ownerDocument: Document,
  ) {}
  addEventListener(name: string, listener: (event: { preventDefault(): void }) => void): void {
    this.listeners.set(name, listener);
  }
  fire(name: string): void {
    this.listeners.get(name)?.({ preventDefault() {} });
  }
  append(...children: (FakeElement | string)[]): void {
    this.children.push(...children);
  }
  replaceChildren(...children: (FakeElement | string)[]): void {
    this.children = children;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

function createDocument(): Document {
  const document = {
    createElement: (tagName: string) => new FakeElement(tagName, document),
  } as unknown as Document;
  return document;
}

function all(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap((child) => (typeof child === "string" ? [] : all(child)))];
}
function text(root: FakeElement): string {
  return all(root)
    .flatMap((element) => [
      element.textContent,
      ...element.children.filter((child) => typeof child === "string"),
    ])
    .filter(Boolean)
    .join(" ");
}

const messages = rendererSettingsMessages("zh-CN");
const result: LocalUsageQueryResult = {
  range: { from: "2026-03-02", to: "2026-03-08" },
  totals: {
    total: 3,
    input: 1,
    cacheRead: 1,
    cacheWrite: 0,
    output: 1,
    reasoning: 0,
    conversations: 1,
  },
  models: 1,
  harnesses: [],
  daily: [],
};

function mount(client: { queryLocalUsage: ReturnType<typeof vi.fn> } | null) {
  const page = createUsageSettingsPage(messages, () => client as RendererUsageClient | null);
  const content = new FakeElement("div", createDocument());
  const context = {
    content,
    signal: new AbortController().signal,
    async runLatest(
      operation: (signal: AbortSignal) => Promise<unknown>,
      handlers: RendererSettingsAsyncHandlers<unknown>,
    ) {
      try {
        handlers.success(await operation(new AbortController().signal));
      } catch (error) {
        handlers.failure(error);
      }
    },
  } as unknown as RendererSettingsPageMountContext;
  page.mount(context);
  const find = (predicate: (element: FakeElement) => boolean) => {
    const element = all(content).find(predicate);
    if (!element) throw new Error("Element not found");
    return element;
  };
  return { page, content, find };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Usage settings page", () => {
  it("expands the dialog and reads new records on open in the local time zone", async () => {
    const queryLocalUsage = vi.fn().mockResolvedValue(result);
    const { page, content } = mount({ queryLocalUsage });
    await vi.waitFor(() => expect(queryLocalUsage).toHaveBeenCalledOnce());
    expect(page.size).toBe("expanded");
    expect(queryLocalUsage).toHaveBeenLastCalledWith({
      period: { kind: "week" },
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      refresh: true,
    });
    await vi.waitFor(() => expect(text(content)).toContain("2026-03-02 – 2026-03-08"));
  });

  it("switches periods without rereading, rereads on refresh, and applies only a valid custom range", async () => {
    const queryLocalUsage = vi.fn().mockResolvedValue(result);
    const { find } = mount({ queryLocalUsage });
    await vi.waitFor(() => expect(queryLocalUsage).toHaveBeenCalledOnce());

    find((element) => element.dataset.usagePeriod === "day").fire("click");
    expect(queryLocalUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({ period: { kind: "day" }, refresh: false }),
    );

    find((element) => element.dataset.usagePeriod === "custom").fire("click");
    const custom = find((element) => element.dataset.usageCustom !== undefined);
    expect(custom.hidden).toBe(false);
    expect(queryLocalUsage).toHaveBeenCalledTimes(2);
    const from = find((element) => element.dataset.usageCustomFrom !== undefined);
    const to = find((element) => element.dataset.usageCustomTo !== undefined);
    expect([from.value, to.value]).toEqual(["2026-03-02", "2026-03-08"]);

    from.value = "2026-03-09";
    custom.fire("submit");
    expect(queryLocalUsage).toHaveBeenCalledTimes(2);
    expect(text(custom)).toContain(messages.usage.customInvalid);

    from.value = "2026-02-01";
    custom.fire("submit");
    expect(queryLocalUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        period: { kind: "custom", from: "2026-02-01", to: "2026-03-08" },
        refresh: false,
      }),
    );

    await vi.waitFor(() =>
      expect(find((element) => element.dataset.usageAction === "refresh").disabled).toBe(false),
    );
    find((element) => element.dataset.usageAction === "refresh").fire("click");
    expect(queryLocalUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        period: { kind: "custom", from: "2026-02-01", to: "2026-03-08" },
        refresh: true,
      }),
    );
  });

  it("tells an unsupported Host apart from a failed read", async () => {
    const unavailable = mount({
      queryLocalUsage: vi
        .fn()
        .mockRejectedValue(new RendererMethodUnavailableError("codexhost/usage/query", undefined)),
    });
    await vi.waitFor(() => expect(text(unavailable.content)).toContain(messages.usage.unavailable));
    const failed = mount({ queryLocalUsage: vi.fn().mockRejectedValue(new Error("boom")) });
    await vi.waitFor(() => expect(text(failed.content)).toContain(messages.usage.failed));
    expect(text(mount(null).content)).toContain(messages.usage.unavailable);
  });
});
