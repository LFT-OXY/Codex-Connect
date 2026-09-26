import type { LocalUsageView } from "@codexhost/shared-contracts";

import type { RendererSettingsMessages } from "./localization.js";

// Complete class names so Tailwind can find them in source.
const SERIES_BACKGROUNDS = [
  "bg-settings-series-1",
  "bg-settings-series-2",
  "bg-settings-series-3",
  "bg-settings-series-4",
  "bg-settings-series-5",
  "bg-settings-series-6",
] as const;

const UNITS = [
  [1e3, "K"],
  [1e6, "M"],
  [1e9, "B"],
] as const;

/** Large counts use K/M/B with at most two decimals. */
export function formatUsageTokens(value: number): string {
  if (value < 1e3) return String(value);
  let text = "";
  for (const [scale, unit] of UNITS) {
    const scaled = Number((value / scale).toFixed(2));
    text = `${scaled}${unit}`;
    // Rounding can reach the next unit, e.g. 999,999 is 1M rather than 1000K.
    if (scaled < 1e3) break;
  }
  return text;
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Estimated Cost with cents; a nonzero amount below a cent is not shown as zero. */
export function formatUsageCost(value: number): string {
  return value > 0 && value < 0.005 ? `<${USD.format(0.01)}` : USD.format(value);
}

function sharePercent(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

/** Two decimals; a nonzero share below that is not shown as zero. */
export function formatUsageShare(percent: number): string {
  return percent > 0 && percent < 0.005 ? "<0.01%" : `${percent.toFixed(2)}%`;
}

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const CARD_CLASS = [
  "flex min-w-40 flex-1 flex-col gap-1 rounded-[10px] px-4 py-3",
  "border border-settings-border bg-settings-panel",
].join(" ");

const TAB_CLASS = [
  "h-7 rounded-md border-0 bg-transparent px-3 text-[13px] leading-5 font-medium",
  "text-settings-muted transition-colors hover:text-settings-text",
  "focus-visible:outline-2 focus-visible:outline-settings-focus",
  "aria-selected:bg-settings-surface aria-selected:text-settings-text",
].join(" ");

export type UsageDetailTab = "daily" | "projects";
export interface UsageDetailTabState {
  selected: UsageDetailTab;
  select(tab: UsageDetailTab): void;
}

type UsageHarness = LocalUsageView["harnesses"][number];

/** Each Provider's share of its Harness, collapsed until opened. */
function providerBreakdown(
  document: Document,
  harness: UsageHarness,
  messages: RendererSettingsMessages["usage"],
): HTMLElement {
  const details = element(document, "details", "mt-1 text-xs");
  details.dataset.usageProviders = harness.harnessId;
  details.append(
    element(
      document,
      "summary",
      "cursor-pointer text-settings-muted select-none hover:text-settings-text",
      messages.providers.replace("{count}", String(harness.providers.length)),
    ),
  );
  const list = element(document, "ul", "m-0 mt-1.5 flex list-none flex-col gap-1 p-0");
  for (const provider of harness.providers) {
    const row = element(document, "li", "flex items-baseline gap-2");
    row.dataset.usageProvider = provider.provider;
    const name = element(document, "span", "min-w-0 flex-1 truncate", provider.provider);
    name.title = provider.provider;
    row.append(
      name,
      element(
        document,
        "span",
        "font-medium tabular-nums",
        formatUsageShare(sharePercent(provider.totalTokens, harness.totalTokens)),
      ),
      element(
        document,
        "span",
        "text-settings-muted",
        messages.models.replace("{count}", String(provider.models)),
      ),
    );
    list.append(row);
  }
  details.append(list);
  return details;
}

function harnessCard(
  document: Document,
  input: {
    id: string;
    name: string;
    share: string;
    models: string;
    series?: string;
    providers?: HTMLElement;
  },
): HTMLElement {
  const card = element(document, "div", CARD_CLASS);
  card.dataset.usageHarnessCard = input.id;
  const heading = element(document, "div", "flex items-center gap-2");
  if (input.series) {
    const swatch = element(document, "span", `size-2.5 shrink-0 rounded-full ${input.series}`);
    swatch.setAttribute("aria-hidden", "true");
    heading.append(swatch);
  }
  heading.append(
    element(document, "span", "truncate text-[13px] leading-5 font-medium", input.name),
  );
  card.append(
    heading,
    element(document, "span", "text-lg leading-7 font-semibold tabular-nums", input.share),
    element(document, "span", "text-xs text-settings-muted", input.models),
  );
  if (input.providers) card.append(input.providers);
  return card;
}

/** Rolling totals and history are period-independent; conversations follow the range. */
function statBlocks(
  document: Document,
  result: LocalUsageView,
  firstActiveDate: string,
  messages: RendererSettingsMessages["usage"],
): HTMLElement {
  const section = element(document, "section", "flex flex-col gap-2");
  const tiles = element(document, "div", "flex flex-wrap gap-3");
  const stats = [
    ["last7Days", result.stats.last7Days, messages.last7Days],
    ["last30Days", result.stats.last30Days, messages.last30Days],
    ["dailyAverage", result.stats.dailyAverage, messages.dailyAverage],
    ["conversations", result.totals.conversations, messages.conversations],
  ] as const;
  for (const [id, value, label] of stats) {
    const tile = element(document, "div", CARD_CLASS);
    tile.dataset.usageStat = id;
    const number = element(
      document,
      "span",
      "text-lg leading-7 font-semibold tabular-nums",
      formatUsageTokens(value),
    );
    number.title = value.toLocaleString();
    tile.append(number, element(document, "span", "text-xs text-settings-muted", label));
    tiles.append(tile);
  }
  const history = element(
    document,
    "div",
    "flex flex-wrap justify-between gap-x-6 gap-y-1 px-1 text-xs text-settings-muted",
  );
  history.dataset.usageHistory = "";
  for (const [label, value] of [
    [messages.firstActiveDate, firstActiveDate],
    [
      messages.activeDays,
      messages.activeDaysValue.replace("{count}", String(result.stats.activeDays)),
    ],
  ] as const) {
    const pair = element(document, "span", "flex items-center gap-1.5");
    pair.append(
      element(document, "span", "", label),
      element(document, "span", "text-settings-text tabular-nums", value),
    );
    history.append(pair);
  }
  section.append(tiles, history);
  return section;
}

function dailyTable(
  document: Document,
  daily: LocalUsageView["daily"],
  messages: RendererSettingsMessages["usage"],
): HTMLElement {
  const scroll = element(
    document,
    "div",
    "overflow-x-auto rounded-[10px] border border-settings-border bg-settings-panel",
  );
  const table = element(document, "table", "w-full border-collapse text-right text-[13px]");
  table.setAttribute("aria-label", messages.dailyTitle);
  const head = element(document, "thead", "");
  const headRow = element(document, "tr", "border-b border-settings-divider");
  messages.dailyColumns.forEach((label, index) => {
    const cell = element(
      document,
      "th",
      `px-4 py-2.5 font-medium whitespace-nowrap text-settings-muted ${index === 0 ? "text-left" : ""}`,
      label,
    );
    cell.scope = "col";
    headRow.append(cell);
  });
  head.append(headRow);
  const body = element(document, "tbody", "");
  for (const day of daily) {
    const row = element(document, "tr", "border-b border-settings-divider last:border-b-0");
    row.dataset.usageDay = day.date;
    const values = [
      day.date,
      formatUsageTokens(day.total),
      formatUsageTokens(day.input),
      formatUsageTokens(day.output),
      formatUsageTokens(day.cacheRead),
      formatUsageTokens(day.reasoning),
      String(day.conversations),
    ];
    values.forEach((value, index) => {
      row.append(
        element(
          document,
          "td",
          `px-4 py-2 whitespace-nowrap tabular-nums ${index === 0 ? "text-left" : ""}`,
          value,
        ),
      );
    });
    body.append(row);
  }
  table.append(head, body);
  scroll.append(table);
  return scroll;
}

/** Projects by usage, each with a bar relative to the most used one. */
function projectList(
  document: Document,
  result: LocalUsageView,
  messages: RendererSettingsMessages["usage"],
): HTMLElement {
  if (result.projects.length === 0) {
    const empty = element(
      document,
      "p",
      "m-0 px-1 text-sm text-settings-muted",
      messages.projectsEmpty,
    );
    empty.setAttribute("role", "status");
    return empty;
  }
  const names = new Map(result.harnesses.map(({ harnessId, name }) => [harnessId, name]));
  const max = result.projects[0]?.totalTokens ?? 0;
  const list = element(
    document,
    "ul",
    "m-0 flex list-none flex-col rounded-[10px] border border-settings-border bg-settings-panel p-0",
  );
  for (const project of result.projects) {
    const row = element(
      document,
      "li",
      "flex items-center gap-4 border-b border-settings-divider px-4 py-2.5 last:border-b-0",
    );
    row.dataset.usageProject = project.project;
    const label = element(document, "div", "flex min-w-0 flex-1 flex-col");
    const slash = project.project.lastIndexOf("/");
    const name = element(document, "span", "truncate text-[13px] leading-5");
    name.title = project.project;
    if (slash > 0) {
      name.append(
        element(document, "span", "text-settings-muted", project.project.slice(0, slash + 1)),
      );
    }
    name.append(element(document, "span", "font-medium", project.project.slice(slash + 1)));
    label.append(
      name,
      element(
        document,
        "span",
        "truncate text-xs text-settings-muted",
        project.harnessIds.map((harnessId) => names.get(harnessId) ?? harnessId).join(" · "),
      ),
    );
    const amount = element(document, "div", "flex w-28 shrink-0 flex-col items-end gap-1");
    const tokens = element(
      document,
      "span",
      "text-[13px] font-medium tabular-nums",
      formatUsageTokens(project.totalTokens),
    );
    tokens.title = project.totalTokens.toLocaleString();
    const bar = usageBar(document, sharePercent(project.totalTokens, max), "h-1 w-full");
    bar.setAttribute("aria-hidden", "true");
    amount.append(tokens, bar);
    row.append(label, amount);
    list.append(row);
  }
  return list;
}

/** A rounded bar filled to `percent`; `sizeClass` sets its height and width. */
export function usageBar(document: Document, percent: number, sizeClass: string): HTMLElement {
  const track = element(
    document,
    "span",
    `block overflow-hidden rounded-full bg-settings-surface-hover ${sizeClass}`,
  );
  const fill = element(document, "span", "block h-full rounded-full bg-settings-series-1");
  fill.style.width = `${percent}%`;
  track.append(fill);
  return track;
}

/** Daily breakdown and project usage share one place; the page remembers the open tab. */
function details(
  document: Document,
  result: LocalUsageView,
  messages: RendererSettingsMessages["usage"],
  tab: UsageDetailTabState | undefined,
): HTMLElement {
  const section = element(document, "section", "flex flex-col gap-2");
  const tabs = element(document, "div", "flex gap-1 px-1");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", messages.detailsLabel);
  const panels = {
    daily: dailyTable(document, result.daily, messages),
    projects: projectList(document, result, messages),
  } satisfies Record<UsageDetailTab, HTMLElement>;
  const buttons = new Map<UsageDetailTab, HTMLButtonElement>();
  const show = (selected: UsageDetailTab): void => {
    for (const [id, button] of buttons) {
      button.setAttribute("aria-selected", String(id === selected));
      button.tabIndex = id === selected ? 0 : -1;
      panels[id].hidden = id !== selected;
    }
  };
  const select = (id: UsageDetailTab): void => {
    show(id);
    tab?.select(id);
  };
  const ids = ["daily", "projects"] as const satisfies UsageDetailTab[];
  ids.forEach((id, index) => {
    const label = id === "daily" ? messages.dailyTitle : messages.projectsTitle;
    const panelId = `codexhost-settings-usage-${id}`;
    const button = element(document, "button", TAB_CLASS, label);
    button.type = "button";
    button.dataset.usageTab = id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panelId);
    button.addEventListener("click", () => select(id));
    // Arrow keys move between tabs, as in the other settings tab lists.
    button.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next = ids[(index + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length];
      if (!next) return;
      select(next);
      buttons.get(next)?.focus();
    });
    buttons.set(id, button);
    tabs.append(button);
    panels[id].id = panelId;
    panels[id].setAttribute("role", "tabpanel");
    panels[id].setAttribute("aria-label", label);
    panels[id].dataset.usageTabPanel = id;
  });
  show(tab?.selected ?? "daily");
  section.append(tabs, panels.daily, panels.projects);
  return section;
}

/** One notice per Harness whose last read failed; its numbers are from an earlier read. */
function failureNotices(
  document: Document,
  failures: LocalUsageView["failures"],
  messages: RendererSettingsMessages["usage"],
): HTMLElement[] {
  return failures.map(({ harnessId, name }) => {
    const notice = element(
      document,
      "p",
      "m-0 rounded-md border border-settings-border px-3 py-2 text-sm text-settings-danger",
      messages.sourceFailed.replace("{name}", name),
    );
    notice.dataset.usageFailure = harnessId;
    notice.setAttribute("role", "alert");
    return notice;
  });
}

/** The page body for one query result; aggregate numbers only. */
export function renderLocalUsage(
  document: Document,
  result: LocalUsageView,
  settingsMessages: RendererSettingsMessages,
  /** The open detail tab, kept by the page across results. */
  tab?: UsageDetailTabState,
): HTMLElement {
  const messages = settingsMessages.usage;
  const { firstActiveDate } = result.stats;
  // Without any counted history the stat blocks would only repeat zeros.
  const stats =
    firstActiveDate === null ? [] : [statBlocks(document, result, firstActiveDate, messages)];
  const root = element(document, "div", "flex flex-col gap-6");

  const summary = element(document, "section", "flex flex-col items-center gap-1 py-4");
  const total = element(
    document,
    "span",
    "text-5xl leading-none font-semibold tracking-tight tabular-nums",
    formatUsageTokens(result.totals.total),
  );
  total.dataset.usageTotal = "";
  total.title = result.totals.total.toLocaleString();
  const cost = element(
    document,
    "span",
    "text-base leading-6 font-medium tabular-nums",
    formatUsageCost(result.estimatedCostUsd),
  );
  cost.dataset.usageCost = "";
  summary.append(
    element(document, "span", "text-xs text-settings-muted", messages.totalTokens),
    total,
    cost,
    element(
      document,
      "span",
      "text-xs text-settings-muted tabular-nums",
      `${result.range.from} – ${result.range.to}`,
    ),
  );
  root.append(...failureNotices(document, result.failures, messages), summary);

  if (result.totals.total === 0 && result.totals.conversations === 0) {
    const empty = element(
      document,
      "p",
      "m-0 text-center text-sm text-settings-muted",
      messages.empty,
    );
    empty.setAttribute("role", "status");
    root.append(empty, ...stats);
    return root;
  }

  const bar = element(
    document,
    "div",
    "flex h-2.5 w-full overflow-hidden rounded-full bg-settings-surface-hover",
  );
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", messages.shareLabel);
  const cards = element(document, "div", "flex flex-wrap gap-3");
  cards.append(
    harnessCard(document, {
      id: "all",
      name: messages.allHarnesses,
      share: "100%",
      models: messages.models.replace("{count}", String(result.models)),
    }),
  );
  result.harnesses.forEach((harness, index) => {
    const series = SERIES_BACKGROUNDS[index % SERIES_BACKGROUNDS.length] ?? SERIES_BACKGROUNDS[0];
    const percent = sharePercent(harness.totalTokens, result.totals.total);
    const segment = element(document, "span", `h-full ${series}`);
    segment.dataset.usageSegment = harness.harnessId;
    segment.style.width = `${percent}%`;
    segment.title = `${harness.name} ${formatUsageShare(percent)}`;
    bar.append(segment);
    cards.append(
      harnessCard(document, {
        id: harness.harnessId,
        name: harness.name,
        share: formatUsageShare(percent),
        models: messages.models.replace("{count}", String(harness.models)),
        series,
        ...(harness.providers.length > 0
          ? { providers: providerBreakdown(document, harness, messages) }
          : {}),
      }),
    );
  });
  root.append(bar, cards, ...stats, details(document, result, messages, tab));
  return root;
}
