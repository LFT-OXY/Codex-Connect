import type { LocalSession } from "@codexhost/shared-contracts";

import { KNOWN_RENDERER_AGENTS, type RendererAgent } from "../agent-selection-state.js";
import { createRendererAgentIcon } from "../renderer-agent-icon.js";
import { createRendererSettingsIcon } from "./icons.js";
import type { RendererSettingsMessages } from "./localization.js";
import { element, formatUsageCost, formatUsageTokens } from "./usage-dashboard.js";

type Messages = RendererSettingsMessages["sessions"];

// Header and rows share these columns so the numbers line up.
const STATS_CLASS = "grid w-[17rem] shrink-0 grid-cols-[4.5rem_4.5rem_3.5rem_3.5rem] text-right";
const ACTIONS_WIDTH_CLASS = "w-52 shrink-0";
export const SESSION_ACTION_CLASS = [
  "inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs",
  "border border-settings-border bg-settings-surface text-settings-text",
  "transition-colors hover:bg-settings-surface-hover disabled:cursor-default disabled:opacity-60",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-settings-focus",
].join(" ");

function isRendererAgent(harnessId: string): harnessId is RendererAgent {
  return (KNOWN_RENDERER_AGENTS as readonly string[]).includes(harnessId);
}

/** Active time in hours and minutes. */
export function formatSessionDuration(ms: number, messages: Messages): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return messages.durationUnderMinute;
  if (minutes < 60) return messages.durationMinutes.replace("{minutes}", String(minutes));
  return messages.durationHoursMinutes
    .replace("{hours}", String(Math.floor(minutes / 60)))
    .replace("{minutes}", String(minutes % 60));
}

/** The Session's own title, else its project, so untitled Sessions stay recognizable. */
export function sessionTitle(session: LocalSession, messages: Messages): string {
  return session.title ?? session.project ?? messages.untitled;
}

export function sessionColumnsHeader(document: Document, messages: Messages): HTMLElement {
  const header = element(
    document,
    "div",
    "flex items-center gap-3 border-b border-settings-border px-2 pb-1.5 text-xs text-settings-muted",
  );
  header.setAttribute("aria-hidden", "true");
  const stats = element(document, "div", STATS_CLASS);
  for (const label of [messages.tokens, messages.cost, messages.turns, messages.edits]) {
    stats.append(element(document, "span", "", label));
  }
  header.append(
    element(document, "span", "w-5 shrink-0"),
    element(document, "span", "min-w-0 flex-1"),
    stats,
    // Room for the row actions.
    element(document, "span", ACTIONS_WIDTH_CLASS),
  );
  return header;
}

/**
 * One Session row. Usage columns stay empty rather than 0 for Sessions known only from Session
 * import, which has no usage.
 */
export function renderSessionRow(
  document: Document,
  session: LocalSession,
  settingsMessages: RendererSettingsMessages,
  actions: readonly HTMLElement[],
): HTMLElement {
  const messages = settingsMessages.sessions;
  const locale = settingsMessages.locale === "zh-CN" ? "zh-CN" : "en";
  const row = element(
    document,
    "article",
    "flex items-center gap-3 border-b border-settings-border px-2 py-2.5",
  );
  row.dataset.sessionId = session.nativeSessionId;
  row.dataset.sessionHarness = session.harnessId;

  const icon = element(document, "span", "flex w-5 shrink-0 justify-center text-settings-text");
  if (isRendererAgent(session.harnessId)) {
    icon.append(createRendererAgentIcon(session.harnessId, 16, document));
  }

  const copy = element(document, "div", "flex min-w-0 flex-1 flex-col gap-0.5");
  const title = element(
    document,
    "strong",
    "truncate text-sm font-medium",
    sessionTitle(session, messages),
  );
  title.title = session.title ?? session.cwd ?? "";
  const details = [
    session.project,
    session.model,
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(session.lastActivityAt),
    ),
    session.activeMs === null ? null : formatSessionDuration(session.activeMs, messages),
    session.subagents > 0 ? messages.subagents.replace("{count}", String(session.subagents)) : null,
  ].filter((value): value is string => value !== null);
  const metadata = element(
    document,
    "span",
    "truncate text-xs text-settings-muted",
    details.join(" · "),
  );
  metadata.dataset.sessionDetails = "";
  copy.append(title, metadata);

  const stats = element(document, "div", `${STATS_CLASS} text-xs tabular-nums`);
  stats.dataset.sessionStats = "";
  const values = [
    session.usage ? formatUsageTokens(session.usage.totalTokens) : "",
    session.usage ? formatUsageCost(session.usage.estimatedCostUsd) : "",
    session.turns === null ? "" : String(session.turns),
    session.edits === null ? "" : String(session.edits),
  ];
  const labels = [messages.tokens, messages.cost, messages.turns, messages.edits];
  values.forEach((value, index) => {
    const cell = element(document, "span", "", value);
    // Screen readers hear each number with its column.
    if (value) cell.setAttribute("aria-label", `${labels[index]}: ${value}`);
    stats.append(cell);
  });
  if (session.usage) stats.title = session.usage.totalTokens.toLocaleString();

  const actionArea = element(
    document,
    "div",
    `flex ${ACTIONS_WIDTH_CLASS} items-center justify-end gap-1.5`,
  );
  if (session.running === true) {
    const running = element(document, "span", "text-xs text-settings-muted", messages.running);
    running.title = messages.runningHint;
    actionArea.append(running);
  }
  actionArea.append(...actions);
  row.append(icon, copy, stats, actionArea);
  return row;
}

export function resumeButton(document: Document, messages: Messages): HTMLButtonElement {
  const button = element(document, "button", SESSION_ACTION_CLASS);
  button.type = "button";
  button.dataset.sessionAction = "resume";
  button.append(createRendererSettingsIcon("external-link", 13), messages.resume);
  return button;
}
