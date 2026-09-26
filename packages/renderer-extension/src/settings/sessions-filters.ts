import type { LocalSession, LocalSessionsView } from "@codexhost/shared-contracts";

import { createRendererSettingsIcon } from "./icons.js";
import type { RendererSettingsMessages } from "./localization.js";
import { SETTINGS_SEGMENT_CLASS } from "./control-classes.js";

type Messages = RendererSettingsMessages["sessions"];

export const SESSION_RANGES = ["all", "7", "30", "90"] as const;
export type SessionRange = (typeof SESSION_RANGES)[number];

/** What the page shows; kept only while the page is open. */
export interface SessionFilter {
  /** Null shows every Harness. */
  harnessId: string | null;
  range: SessionRange;
  /** Null shows every project. */
  project: string | null;
  query: string;
}

const DAY_MS = 86_400_000;

/** Sessions matching the filter, in their listed order. */
export function filterSessions(
  sessions: readonly LocalSession[],
  filter: SessionFilter,
  now: number,
): LocalSession[] {
  const since = filter.range === "all" ? null : now - Number(filter.range) * DAY_MS;
  const query = filter.query.trim().toLocaleLowerCase();
  return sessions.filter(
    (session) =>
      (filter.harnessId === null || session.harnessId === filter.harnessId) &&
      (since === null || session.lastActivityAt >= since) &&
      (filter.project === null || session.project === filter.project) &&
      (!query ||
        [session.title, session.project, session.model, session.nativeSessionId].some((value) =>
          value?.toLocaleLowerCase().includes(query),
        )),
  );
}

const SEGMENTS_CLASS = "inline-flex flex-wrap gap-0.5 rounded-lg bg-settings-surface p-0.5";
const FIELD_CLASS = [
  "h-8 rounded-md border border-settings-border bg-settings-surface px-2 text-[13px]",
  "text-settings-text focus-visible:outline-2 focus-visible:outline-settings-focus",
].join(" ");

function rangeLabel(range: SessionRange, messages: Messages): string {
  switch (range) {
    case "all":
      return messages.rangeAll;
    case "7":
      return messages.range7;
    case "30":
      return messages.range30;
    case "90":
      return messages.range90;
  }
}

/**
 * Harness, time range and project filters with search. Harness and project choices come from the
 * listed Sessions, so a Harness without Sessions has no tab.
 */
export function createSessionFilters(
  document: Document,
  messages: Messages,
  onChange: () => void,
): { root: HTMLElement; filter(): SessionFilter; update(view: LocalSessionsView): void } {
  const filter: SessionFilter = { harnessId: null, range: "all", project: null, query: "" };
  const root = document.createElement("div");
  root.className = "mt-4 flex flex-col gap-2";
  root.hidden = true;

  const harnesses = document.createElement("div");
  harnesses.className = SEGMENTS_CLASS;
  harnesses.setAttribute("role", "group");
  harnesses.setAttribute("aria-label", messages.harnessFilterLabel);
  harnesses.dataset.sessionsHarnessFilter = "";

  const row = document.createElement("div");
  row.className = "flex flex-wrap items-center gap-2";
  const ranges = document.createElement("div");
  ranges.className = SEGMENTS_CLASS;
  ranges.setAttribute("role", "group");
  ranges.setAttribute("aria-label", messages.rangeFilterLabel);
  const rangeButtons = new Map<SessionRange, HTMLButtonElement>();
  for (const range of SESSION_RANGES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = SETTINGS_SEGMENT_CLASS;
    button.dataset.sessionsRange = range;
    button.textContent = rangeLabel(range, messages);
    button.addEventListener("click", () => {
      if (filter.range === range) return;
      filter.range = range;
      renderPressed();
      onChange();
    });
    rangeButtons.set(range, button);
    ranges.append(button);
  }

  const project = document.createElement("select");
  project.className = `${FIELD_CLASS} max-w-56`;
  project.dataset.sessionsProjectFilter = "";
  project.setAttribute("aria-label", messages.projectFilterLabel);
  project.addEventListener("change", () => {
    filter.project = project.value || null;
    onChange();
  });

  const search = document.createElement("label");
  search.className = `${FIELD_CLASS} flex min-w-48 flex-1 items-center gap-1.5`;
  const input = document.createElement("input");
  input.type = "search";
  input.className = "min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none";
  input.placeholder = messages.searchPlaceholder;
  input.setAttribute("aria-label", messages.searchLabel);
  input.dataset.sessionsSearch = "";
  input.addEventListener("input", () => {
    filter.query = input.value;
    onChange();
  });
  search.append(createRendererSettingsIcon("search", 14), input);
  row.append(ranges, project, search);
  root.append(harnesses, row);

  const harnessButtons = new Map<string | null, HTMLButtonElement>();
  function renderPressed(): void {
    for (const [id, button] of harnessButtons) {
      button.setAttribute("aria-pressed", String(id === filter.harnessId));
    }
    for (const [range, button] of rangeButtons) {
      button.setAttribute("aria-pressed", String(range === filter.range));
    }
  }

  const update = (view: LocalSessionsView): void => {
    root.hidden = view.sessions.length === 0;
    // A Harness or project that no longer has Sessions stops filtering.
    if (!view.harnesses.some(({ harnessId }) => harnessId === filter.harnessId)) {
      filter.harnessId = null;
    }
    const projects = [
      ...new Set(view.sessions.flatMap(({ project: name }) => (name ? [name] : []))),
    ].sort((left, right) => left.localeCompare(right));
    if (filter.project !== null && !projects.includes(filter.project)) filter.project = null;

    harnessButtons.clear();
    const choices: { id: string | null; name: string }[] = [
      { id: null, name: messages.harnessAll },
      ...view.harnesses.map(({ harnessId, name }) => ({ id: harnessId as string, name })),
    ];
    harnesses.replaceChildren(
      ...choices.map(({ id, name }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = SETTINGS_SEGMENT_CLASS;
        button.dataset.sessionsHarness = id ?? "all";
        button.textContent = name;
        button.addEventListener("click", () => {
          if (filter.harnessId === id) return;
          filter.harnessId = id;
          renderPressed();
          onChange();
        });
        harnessButtons.set(id, button);
        return button;
      }),
    );

    const all = document.createElement("option");
    all.value = "";
    all.textContent = messages.projectAll;
    project.replaceChildren(
      all,
      ...projects.map((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        return option;
      }),
    );
    project.value = filter.project ?? "";
    renderPressed();
  };

  return { root, filter: () => ({ ...filter }), update };
}
