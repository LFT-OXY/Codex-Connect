import type { LocalUsageQueryResult } from "@codexhost/shared-contracts";

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

type UsageHarness = LocalUsageQueryResult["harnesses"][number];

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
  result: LocalUsageQueryResult,
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
  daily: LocalUsageQueryResult["daily"],
  messages: RendererSettingsMessages["usage"],
): HTMLElement {
  const section = element(document, "section", "flex flex-col gap-2");
  section.append(
    element(document, "h3", "m-0 px-1 text-[13px] leading-5 font-semibold", messages.dailyTitle),
  );
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
  section.append(scroll);
  return section;
}

/** The page body for one query result; aggregate numbers only. */
export function renderLocalUsage(
  document: Document,
  result: LocalUsageQueryResult,
  settingsMessages: RendererSettingsMessages,
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
  root.append(summary);

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
  root.append(bar, cards, ...stats, dailyTable(document, result.daily, messages));
  return root;
}
