import type { AccountCreditsSnapshot, AccountResetCredit } from "@codexhost/shared-contracts";

import { formatRendererCreditsReset, rendererCreditsTone } from "../renderer-credits-control.js";
import { formatRendererCreditsPercent } from "../renderer-usage-control.js";
import {
  formatAccountFullLocalTime,
  renderAccountPaceMarker,
  renderAccountResetTime,
} from "./accounts-reset-time.js";
import {
  accountResetCreditLife,
  accountResetCreditTone,
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

function renderMeter(
  document: Document,
  label: string,
  value: number,
  valueNow: string,
): HTMLElement {
  const meter = document.createElement("div");
  meter.className = WINDOW_METER_CLASS;
  meter.setAttribute("role", "meter");
  meter.setAttribute("aria-label", label);
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", "100");
  meter.setAttribute("aria-valuenow", valueNow);
  const fill = document.createElement("span");
  fill.className = WINDOW_FILL_CLASS;
  fill.style.width = `${Math.min(100, Math.max(0, value))}%`;
  meter.append(fill);
  return meter;
}

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
  const meter = renderMeter(document, `${window.label} · ${valueLabel}`, value, String(value));
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

const RESET_EXPIRY_CLASS = [
  "col-span-2 col-start-3 min-w-0 truncate text-right text-[11px] tabular-nums whitespace-nowrap",
  "text-settings-muted @max-[28rem]:col-start-2",
  "group-data-[tone=warn]:text-settings-warning group-data-[tone=hot]:text-settings-danger",
].join(" ");

function renderResetCredit(
  document: Document,
  credit: AccountResetCredit,
  index: number,
  messages: RendererSettingsMessages,
  now: number,
): HTMLElement {
  const row = document.createElement("div");
  row.className = WINDOW_ROW_CLASS;
  row.dataset.resetCredit = "";
  const expiresAt = Date.parse(credit.expiresAt);
  row.dataset.tone = Number.isFinite(expiresAt) ? accountResetCreditTone(expiresAt, now) : "ok";
  const label = document.createElement("span");
  label.className = "min-w-0 truncate text-xs text-settings-muted";
  label.textContent = messages.accountResetCreditLabel.replace("{index}", String(index));
  row.append(label);
  const life = accountResetCreditLife(credit, now);
  if (life !== null) {
    row.append(
      renderMeter(
        document,
        `${label.textContent} · ${messages.accountResetCreditLife}`,
        life,
        String(Math.round(life)),
      ),
    );
  }
  if (Number.isFinite(expiresAt)) {
    const expiry = document.createElement("time");
    expiry.className = RESET_EXPIRY_CLASS;
    expiry.dateTime = new Date(expiresAt).toISOString();
    expiry.textContent = formatAccountCreditsReset(
      credit.expiresAt,
      messages.locale,
      new Date(now),
    );
    expiry.title = messages.accountResetCreditsCardExpiry
      .replace("{index}", String(index))
      .replace("{time}", formatAccountFullLocalTime(credit.expiresAt, messages.locale));
    expiry.setAttribute("aria-label", expiry.title);
    row.append(expiry);
  }
  return row;
}

/** 只读清单：每张卡一条寿命横条，不提供使用入口。 */
export function renderAccountResetCredits(
  document: Document,
  credits: AccountCreditsSnapshot,
  messages: RendererSettingsMessages,
  now = Date.now(),
): HTMLElement | null {
  const resetCredits = credits.resetCredits;
  if (!resetCredits) return null;
  const section = document.createElement("div");
  section.className = "grid gap-2.5";
  section.dataset.resetCredits = "";
  section.setAttribute("role", "group");
  section.setAttribute("aria-label", messages.accountResetCredits);
  const heading = document.createElement("div");
  heading.className = "flex items-center gap-1.5 text-[11px] text-settings-muted";
  const label = document.createElement("span");
  label.textContent = messages.accountResetCredits;
  const count = document.createElement("span");
  count.className = "tabular-nums";
  count.textContent =
    messages.locale === "zh-CN"
      ? `${resetCredits.availableCount} 张`
      : String(resetCredits.availableCount);
  heading.append(createRendererSettingsIcon("ticket", 14), label, count);
  section.append(heading);
  // 旧 Host 只给到期时间列表，按无发放时间处理。
  const cards =
    resetCredits.credits ?? resetCredits.expiresAt?.map((expiresAt) => ({ expiresAt })) ?? [];
  for (const [index, credit] of cards.entries()) {
    section.append(renderResetCredit(document, credit, index + 1, messages, now));
  }
  return section;
}
