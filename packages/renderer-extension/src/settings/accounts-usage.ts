import type { AccountCreditsSnapshot } from "@codexhost/shared-contracts";

import { formatRendererCreditsReset, rendererCreditsTone } from "../renderer-credits-control.js";
import { formatRendererCreditsPercent } from "../renderer-usage-control.js";
import { renderAccountPaceMarker, renderAccountResetTime } from "./accounts-reset-time.js";
import {
  accountUsageWindowRows,
  type AccountUsageDisplay,
  type AccountUsageWindowFilter,
  type AccountUsageWindowRow,
} from "./accounts-usage-windows.js";
import { createRendererSettingsIcon } from "./icons.js";
import type { RendererSettingsMessages } from "./localization.js";

export type AccountUsageViewState =
  | { readonly status: "loading" }
  | { readonly status: "empty" }
  | { readonly status: "error" }
  | {
      readonly status: "ready";
      readonly credits: AccountCreditsSnapshot;
      readonly freshness: "live" | "cached";
      readonly observedAt: string | null;
    };

export type { AccountUsageDisplay } from "./accounts-usage-windows.js";

export function formatAccountCreditsReset(
  value: string,
  locale: RendererSettingsMessages["locale"],
  now: Date = new Date(),
): string {
  if (locale !== "zh-CN") return formatRendererCreditsReset(value, now);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (isToday) {
    return `今天 ${date.toLocaleTimeString("zh-CN", { hour: "numeric", minute: "2-digit" })}`;
  }
  return date.toLocaleString("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function resetCreditDetailLine(
  index: number,
  expiresAt: string,
  messages: RendererSettingsMessages,
  now: Date = new Date(),
): string {
  return messages.accountResetCreditsCardExpiry
    .replace("{index}", String(index))
    .replace("{time}", formatAccountCreditsReset(expiresAt, messages.locale, now));
}

const WINDOW_ROW_CLASS = [
  "group grid grid-cols-[minmax(0,9rem)_minmax(4rem,1fr)_3.5rem_3.75rem] items-center gap-x-3",
  "@max-[28rem]:grid-cols-[minmax(0,1fr)_3.5rem_3.75rem] @max-[28rem]:gap-y-1.5",
].join(" ");
const WINDOW_METER_CLASS = [
  "relative h-1.5 rounded-full bg-settings-surface-hover",
  "@max-[28rem]:order-last @max-[28rem]:col-span-3",
].join(" ");
const WINDOW_FILL_CLASS = [
  "block h-full rounded-full bg-settings-success",
  "group-data-[tone=warn]:bg-settings-warning group-data-[tone=hot]:bg-settings-danger",
].join(" ");
const WINDOW_PERCENT_CLASS = [
  "text-right text-xs font-semibold tabular-nums whitespace-nowrap text-settings-text",
  "group-data-[tone=warn]:text-settings-warning group-data-[tone=hot]:text-settings-danger",
].join(" ");

function renderUsageWindow(
  document: Document,
  window: AccountUsageWindowRow,
  messages: RendererSettingsMessages,
  display: AccountUsageDisplay,
): HTMLElement {
  const row = document.createElement("div");
  row.className = WINDOW_ROW_CLASS;
  row.dataset.usageWindow = "";
  row.dataset.tone = rendererCreditsTone(window.usedPercent);
  const label = document.createElement("span");
  label.className = "min-w-0 truncate text-xs text-settings-muted";
  label.textContent = window.label;
  label.title = window.label;
  const value = display === "remaining" ? 100 - window.usedPercent : window.usedPercent;
  const valueLabel =
    display === "remaining" ? messages.accountCreditsRemaining : messages.accountCreditsUsed;
  const meter = document.createElement("div");
  meter.className = WINDOW_METER_CLASS;
  meter.setAttribute("role", "meter");
  meter.setAttribute("aria-label", `${window.label} · ${valueLabel}`);
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", "100");
  meter.setAttribute("aria-valuenow", String(value));
  const fill = document.createElement("span");
  fill.className = WINDOW_FILL_CLASS;
  fill.style.width = `${Math.min(100, Math.max(0, value))}%`;
  meter.append(fill);
  renderAccountPaceMarker(document, meter, window, display, messages);
  const percent = document.createElement("span");
  percent.className = WINDOW_PERCENT_CLASS;
  percent.textContent = formatRendererCreditsPercent(value);
  const reset = window.resetsAt
    ? renderAccountResetTime(document, window.resetsAt, messages)
    : null;
  row.append(label, meter, percent, reset ?? document.createElement("span"));
  return row;
}

function renderUsageMessage(
  document: Document,
  state: Exclude<AccountUsageViewState, { status: "ready" }> | undefined,
  messages: RendererSettingsMessages,
  onRetry: () => void,
): HTMLElement {
  const usage = document.createElement("div");
  usage.className = "flex items-center gap-3 text-xs text-settings-muted";
  const message = document.createElement("span");
  message.textContent = !state
    ? "—"
    : state.status === "loading"
      ? messages.accountCreditsLoading
      : state.status === "error"
        ? messages.accountCreditsFailed
        : messages.accountCreditsEmpty;
  if (!state) message.title = messages.accountCreditsEmpty;
  usage.append(message);
  if (state?.status === "loading") usage.setAttribute("aria-busy", "true");
  if (state?.status === "error") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "settings-command-button settings-command-button--secondary";
    retry.textContent = messages.accountCreditsRetry;
    retry.addEventListener("click", onRetry);
    usage.append(retry);
  }
  return usage;
}

export function renderAccountUsage(
  document: Document,
  state: AccountUsageViewState | undefined,
  messages: RendererSettingsMessages,
  display: AccountUsageDisplay,
  onRetry: () => void,
  filter: AccountUsageWindowFilter = "all",
): HTMLElement {
  if (state?.status !== "ready") return renderUsageMessage(document, state, messages, onRetry);
  const rows = accountUsageWindowRows(state.credits, messages, filter);
  if (rows.length === 0) return renderUsageMessage(document, undefined, messages, onRetry);
  const list = document.createElement("div");
  list.className = "grid gap-2.5";
  for (const window of rows) list.append(renderUsageWindow(document, window, messages, display));
  return list;
}

export function renderAccountResetCredits(
  document: Document,
  credits: AccountCreditsSnapshot,
  messages: RendererSettingsMessages,
): { summary: HTMLButtonElement; details: HTMLElement } | null {
  const resetCredits = credits.resetCredits;
  if (!resetCredits) return null;
  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "settings-account-reset-summary";
  summary.setAttribute("aria-label", messages.accountResetCreditsDetails);
  summary.title = messages.accountResetCreditsDetails;
  const count = document.createElement("span");
  count.textContent =
    messages.locale === "zh-CN"
      ? `${resetCredits.availableCount} 张`
      : String(resetCredits.availableCount);
  const label = document.createElement("span");
  label.textContent = messages.accountResetCredits;
  summary.append(
    createRendererSettingsIcon("ticket", 16),
    label,
    count,
    createRendererSettingsIcon("chevron-right", 14),
  );

  const details = document.createElement("div");
  details.className = "settings-account-reset-details";
  const copy = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = messages.accountResetCredits;
  copy.append(heading);
  if (resetCredits.nextExpiresAt) {
    const next = document.createElement("p");
    next.className = "settings-account-reset-expiry";
    const reset = formatAccountCreditsReset(resetCredits.nextExpiresAt, messages.locale);
    next.textContent = messages.locale === "zh-CN" ? `最早 ${reset}到期` : `Next expires ${reset}`;
    const remaining = Date.parse(resetCredits.nextExpiresAt) - Date.now();
    if (remaining <= 24 * 60 * 60 * 1000) {
      next.className += remaining <= 8 * 60 * 60 * 1000 ? " is-hot" : " is-warn";
    }
    copy.append(next);
  }
  if (resetCredits.expiresAt?.length) {
    const list = document.createElement("ul");
    list.className = "settings-account-reset-list";
    for (const [index, expiresAt] of resetCredits.expiresAt.entries()) {
      const item = document.createElement("li");
      item.textContent = resetCreditDetailLine(index + 1, expiresAt, messages);
      list.append(item);
    }
    copy.append(list);
  }
  details.append(copy);
  return { summary, details };
}
