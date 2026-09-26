import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  HostThreadId,
  LocalSession,
  LocalSessionsQueryResult,
} from "@codexhost/shared-contracts";

vi.mock("../../src/settings/icons.js", () => ({
  createRendererSettingsIcon: () => "icon",
}));
vi.mock("../../src/renderer-agent-icon.js", () => ({
  createRendererAgentIcon: () => "agent-icon",
}));

import type {
  RendererSettingsAsyncHandlers,
  RendererSettingsPageMountContext,
} from "../../src/settings/core.js";
import { rendererSettingsMessages } from "../../src/settings/localization.js";
import type { RendererImportedThreadOpener } from "../../src/settings/session-import-page.js";
import { filterSessions, type SessionFilter } from "../../src/settings/sessions-filters.js";
import {
  createSessionsSettingsPage,
  type RendererSessionsClient,
} from "../../src/settings/sessions-page.js";

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
  hidden = false;
  disabled = false;
  tabIndex = 0;
  focused = false;
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
  parent: FakeElement | null = null;
  append(...children: (FakeElement | string)[]): void {
    for (const child of children) if (typeof child !== "string") child.parent = this;
    this.children.push(...children);
  }
  replaceChildren(...children: (FakeElement | string)[]): void {
    this.children = [];
    this.append(...children);
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  focus(): void {
    this.focused = true;
  }
}

function createDocument(clipboard?: { writeText: ReturnType<typeof vi.fn> }): Document {
  const document = {
    createElement: (tagName: string) => new FakeElement(tagName, document),
    defaultView: { navigator: { clipboard }, setTimeout: () => 0 },
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
const THREAD = "thread-1" as HostThreadId;

function session(overrides: Partial<LocalSession> = {}): LocalSession {
  return {
    harnessId: "claude-code" as LocalSession["harnessId"],
    nativeSessionId: "11111111-1111-4111-8111-111111111111",
    title: "Synthetic title",
    cwd: "/work/project",
    project: "owner/project",
    model: "claude-synthetic-1",
    startedAt: Date.parse("2026-03-02T10:00:00.000Z"),
    lastActivityAt: Date.parse("2026-03-02T11:14:00.000Z"),
    activeMs: 74 * 60_000,
    usage: { totalTokens: 1_430, estimatedCostUsd: 0.02 },
    turns: 2,
    edits: 1,
    subagents: 1,
    threadId: null,
    resumable: true,
    running: null,
    ...overrides,
  };
}

function view(sessions: LocalSession[]): LocalSessionsQueryResult {
  return {
    status: "ready",
    sessions,
    foldedSubagents: sessions.reduce((sum, { subagents }) => sum + subagents, 0),
    harnesses: [{ harnessId: "claude-code" as LocalSession["harnessId"], name: "Claude Code" }],
    failures: [],
  };
}

function mount(
  client: Partial<Record<keyof RendererSessionsClient, ReturnType<typeof vi.fn>>> | null,
  options: {
    openThread?: ReturnType<typeof vi.fn>;
    clipboard?: { writeText: ReturnType<typeof vi.fn> };
  } = {},
) {
  const openThread = options.openThread ?? vi.fn().mockResolvedValue(undefined);
  const page = createSessionsSettingsPage(
    messages,
    () => client as RendererSessionsClient | null,
    openThread as unknown as RendererImportedThreadOpener,
  );
  const content = new FakeElement("div", createDocument(options.clipboard));
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
  const rows = () => all(content).filter((element) => element.dataset.sessionId !== undefined);
  return { content, find, rows, openThread };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Sessions settings page", () => {
  it("reads new records on open and shows each Session's details and usage", async () => {
    const queryLocalSessions = vi
      .fn()
      .mockResolvedValue(
        view([
          session(),
          session({ nativeSessionId: "22222222-2222-4222-8222-222222222222", title: null }),
          session({ nativeSessionId: "3", title: null, project: null }),
        ]),
      );
    const { rows } = mount({ queryLocalSessions });
    await vi.waitFor(() => expect(rows()).toHaveLength(3));
    expect(queryLocalSessions).toHaveBeenCalledWith({ refresh: true });
    const [first, untitled, unnamed] = rows();
    const row = first as FakeElement;
    expect(text(row)).toContain("Synthetic title");
    expect(
      text(all(row).find((element) => element.dataset.sessionDetails !== undefined) as FakeElement),
    ).toMatch(/^owner\/project · claude-synthetic-1 · .+ · 1 小时 14 分 · 1 个子代理$/u);
    const stats = all(row).find((element) => element.dataset.sessionStats !== undefined);
    expect(stats?.children.map((cell) => (cell as FakeElement).textContent)).toEqual([
      "1.43K",
      "$0.02",
      "2",
      "1",
    ]);
    // Without a title the project names the Session.
    expect(text(untitled as FakeElement)).toContain("owner/project");
    expect(text(unnamed as FakeElement)).toContain(messages.sessions.untitled);
  });

  it("maps an unmapped Session before opening it and opens a mapped one directly", async () => {
    const importHarnessSession = vi.fn().mockResolvedValue({ threadId: THREAD });
    const mapped = session({ nativeSessionId: "mapped", threadId: "thread-2" as HostThreadId });
    const { find, openThread } = mount({
      queryLocalSessions: vi.fn().mockResolvedValue(view([session(), mapped])),
      importHarnessSession,
    });
    const rowButton = (id: string) =>
      all(find((element) => element.dataset.sessionId === id)).find(
        (element) => element.dataset.sessionAction === "resume",
      ) as FakeElement;
    await vi.waitFor(() => expect(rowButton("mapped")).toBeDefined());

    rowButton("11111111-1111-4111-8111-111111111111").fire("click");
    await vi.waitFor(() => expect(openThread).toHaveBeenCalledWith(THREAD, expect.anything()));
    expect(importHarnessSession).toHaveBeenCalledWith({
      harnessId: "claude-code",
      nativeSessionId: "11111111-1111-4111-8111-111111111111",
    });

    rowButton("mapped").fire("click");
    await vi.waitFor(() => expect(openThread).toHaveBeenCalledWith("thread-2", expect.anything()));
    expect(importHarnessSession).toHaveBeenCalledOnce();
  });

  it("explains a failed Resume and offers the project path and another try", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const importHarnessSession = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { code: -32079 }))
      .mockResolvedValue({ threadId: THREAD });
    const openThread = vi
      .fn()
      .mockRejectedValueOnce(new Error("no route"))
      .mockResolvedValue(undefined);
    const { find, content } = mount(
      { queryLocalSessions: vi.fn().mockResolvedValue(view([session()])), importHarnessSession },
      { openThread, clipboard: { writeText } },
    );
    const action = (name: string) => find((element) => element.dataset.sessionAction === name);
    await vi.waitFor(() => expect(action("resume")).toBeDefined());

    action("resume").fire("click");
    await vi.waitFor(() => expect(text(content)).toContain(messages.sessions.resumeGone));
    action("copy-project-path").fire("click");
    expect(writeText).toHaveBeenCalledWith("/work/project");

    // Mapping now succeeds, but the Thread does not open.
    action("retry-open").fire("click");
    await vi.waitFor(() => expect(text(content)).toContain(messages.sessions.openFailed));
    expect(openThread).toHaveBeenCalledTimes(1);

    // Retrying opens the Thread already mapped instead of mapping again.
    action("retry-open").fire("click");
    await vi.waitFor(() => expect(openThread).toHaveBeenCalledTimes(2));
    expect(importHarnessSession).toHaveBeenCalledTimes(2);
  });

  it("opens an official Codex Session as the Codex Thread of the same ID", async () => {
    const importHarnessSession = vi.fn();
    const openThread = vi.fn().mockRejectedValueOnce(new Error("not in sidebar"));
    const codex = session({
      harnessId: "codex",
      nativeSessionId: "01a0cbbd-4cfb-7771-ad32-a4ecf7f134f9",
      threadId: "01a0cbbd-4cfb-7771-ad32-a4ecf7f134f9" as HostThreadId,
    });
    const { find, content } = mount(
      { queryLocalSessions: vi.fn().mockResolvedValue(view([codex])), importHarnessSession },
      { openThread },
    );
    await vi.waitFor(() =>
      expect(find((element) => element.dataset.sessionAction === "resume")).toBeDefined(),
    );
    find((element) => element.dataset.sessionAction === "resume").fire("click");
    await vi.waitFor(() => expect(text(content)).toContain(messages.sessions.codexOpenFailed));
    expect(openThread).toHaveBeenCalledWith(codex.threadId, expect.anything());
    expect(importHarnessSession).not.toHaveBeenCalled();
  });

  it("disables Resume for a Harness that cannot open existing Sessions", async () => {
    const { find } = mount({
      queryLocalSessions: vi.fn().mockResolvedValue(view([session({ resumable: false })])),
    });
    await vi.waitFor(() =>
      expect(find((element) => element.dataset.sessionAction === "resume").disabled).toBe(true),
    );
    expect(find((element) => element.dataset.sessionAction === "resume").title).toBe(
      messages.sessions.resumeUnavailable,
    );
  });

  it("shows read progress and asks again until the Sessions are ready", async () => {
    vi.useFakeTimers();
    const queryLocalSessions = vi
      .fn()
      .mockResolvedValueOnce({ status: "reading", progress: { processed: 3, total: 10 } })
      .mockResolvedValue(view([session()]));
    const { content, rows } = mount({ queryLocalSessions });
    await vi.waitFor(() => expect(text(content)).toContain("3 / 10"));
    await vi.advanceTimersByTimeAsync(500);
    expect(queryLocalSessions).toHaveBeenLastCalledWith({ refresh: false });
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
  });

  it("lists other sources when one fails", async () => {
    const { content, rows } = mount({
      queryLocalSessions: vi.fn().mockResolvedValue({
        ...view([session()]),
        failures: [{ harnessId: "pi", name: "Pi" }],
      }),
    });
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
    expect(text(content)).toContain("无法读取 Pi 的会话记录");
  });
  it("filters by Harness, time range, project and search, with a folded-subagents summary", async () => {
    const now = Date.now();
    const day = 86_400_000;
    const sessions = [
      session({ nativeSessionId: "a", lastActivityAt: now - day, subagents: 2 }),
      session({
        nativeSessionId: "b",
        harnessId: "pi" as LocalSession["harnessId"],
        project: "other",
        title: "Refactor parser",
        lastActivityAt: now - 20 * day,
        subagents: 0,
      }),
      session({ nativeSessionId: "c", model: "gpt-special", lastActivityAt: now - 60 * day }),
    ];
    const { content, find, rows } = mount({
      queryLocalSessions: vi.fn().mockResolvedValue({
        ...view(sessions),
        harnesses: [
          { harnessId: "claude-code", name: "Claude Code" },
          { harnessId: "pi", name: "Pi" },
        ],
      }),
    });
    const ids = () => rows().map(({ dataset }) => dataset.sessionId);
    const summary = () =>
      find((element) => element.dataset.sessionsSummary !== undefined).textContent;
    await vi.waitFor(() => expect(ids()).toEqual(["a", "b", "c"]));
    expect(summary()).toBe("3 个主线程 · 3 个子代理已折叠");
    // Only Harnesses with Sessions get a tab.
    expect(
      all(content)
        .filter(({ dataset }) => dataset.sessionsHarness !== undefined)
        .map(({ textContent }) => textContent),
    ).toEqual(["全部", "Claude Code", "Pi"]);

    find(({ dataset }) => dataset.sessionsHarness === "pi").fire("click");
    expect(ids()).toEqual(["b"]);
    expect(summary()).toBe("1 个主线程 · 0 个子代理已折叠");
    find(({ dataset }) => dataset.sessionsHarness === "all").fire("click");

    find(({ dataset }) => dataset.sessionsRange === "30").fire("click");
    expect(ids()).toEqual(["a", "b"]);
    const project = find(({ dataset }) => dataset.sessionsProjectFilter !== undefined);
    project.value = "other";
    project.fire("change");
    expect(ids()).toEqual(["b"]);
    project.value = "";
    project.fire("change");

    const search = find(({ dataset }) => dataset.sessionsSearch !== undefined);
    search.value = "PARSER";
    search.fire("input");
    expect(ids()).toEqual(["b"]);
    search.value = "nothing";
    search.fire("input");
    expect(ids()).toEqual([]);
    expect(text(content)).toContain(messages.sessions.noMatches);
  });

  it("renders thousands of Sessions a batch at a time", async () => {
    const sessions = Array.from({ length: 450 }, (_, index) =>
      session({ nativeSessionId: `s-${index}` }),
    );
    const { find, rows } = mount({
      queryLocalSessions: vi.fn().mockResolvedValue(view(sessions)),
    });
    await vi.waitFor(() => expect(rows()).toHaveLength(200));
    const more = find(({ dataset }) => dataset.sessionsAction === "show-more");
    expect(more.textContent).toBe("显示更多（还有 250 个）");
    more.fire("click");
    expect(rows()).toHaveLength(400);
    expect(more.textContent).toBe("显示更多（还有 50 个）");
    more.fire("click");
    expect(rows()).toHaveLength(450);
    expect(() => find(({ dataset }) => dataset.sessionsAction === "show-more")).toThrow();
  });
});

describe("Session filtering", () => {
  const filter = (overrides: Partial<SessionFilter>): SessionFilter => ({
    harnessId: null,
    range: "all",
    project: null,
    query: "",
    ...overrides,
  });

  it("searches title, project, model and ID, but not the working directory", () => {
    const sessions = [session({ nativeSessionId: "abc-123", cwd: "/secret/place" })];
    for (const query of ["synthetic TITLE", "owner/", "SYNTHETIC-1", "abc-1"]) {
      expect(filterSessions(sessions, filter({ query }), 0)).toHaveLength(1);
    }
    expect(filterSessions(sessions, filter({ query: "secret" }), 0)).toHaveLength(0);
  });

  it("keeps Sessions active within the range, inclusive of its start", () => {
    const now = Date.parse("2026-03-31T00:00:00.000Z");
    const sessions = [
      session({ nativeSessionId: "edge", lastActivityAt: now - 7 * 86_400_000 }),
      session({ nativeSessionId: "old", lastActivityAt: now - 7 * 86_400_000 - 1 }),
    ];
    expect(
      filterSessions(sessions, filter({ range: "7" }), now).map(
        ({ nativeSessionId }) => nativeSessionId,
      ),
    ).toEqual(["edge"]);
  });
});
