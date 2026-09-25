import {
  accountUsagePace,
  type AccountUsageDisplay,
  type AccountUsageWindowRow,
} from "./accounts-usage-windows.js";
import type { RendererSettingsMessages } from "./localization.js";

/** At most two units; elapsed time never implies that a quota request succeeded. */
export function formatAccountResetCountdown(
  value: string,
  messages: RendererSettingsMessages,
  now = Date.now(),
): { text: string; description: string } | null {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const minutes = Math.max(0, Math.ceil((timestamp - now) / 60_000));
  if (minutes === 0) {
    return {
      text: messages.accountCreditsResetPending,
      description: messages.accountCreditsResetPendingHint,
    };
  }
  const chinese = messages.locale === "zh-CN";
  const parts = [
    { value: Math.floor(minutes / 1440), unit: "d", label: chinese ? "天" : " days" },
    { value: Math.floor((minutes % 1440) / 60), unit: "h", label: chinese ? "小时" : " hours" },
    { value: minutes % 60, unit: "m", label: chinese ? "分钟" : " minutes" },
  ].filter((part, index) => part.value > 0 && (minutes < 1440 || index < 2));
  return {
    text: parts.map((part) => `${part.value}${part.unit}`).join(""),
    description: messages.accountCreditsResetIn.replace(
      "{time}",
      parts
        .map(
          (part) =>
            `${part.value}${!chinese && part.value === 1 ? part.label.slice(0, -1) : part.label}`,
        )
        .join(chinese ? "" : " "),
    ),
  };
}

function fullResetTime(value: string, messages: RendererSettingsMessages): string {
  return messages.accountCreditsResetAt.replace(
    "{time}",
    new Date(value).toLocaleString(messages.locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }),
  );
}

function updateCountdown(element: HTMLElement, messages: RendererSettingsMessages): void {
  const resetsAt = element.dataset.resetsAt ?? "";
  const value = formatAccountResetCountdown(resetsAt, messages);
  if (!value) return;
  element.textContent = value.text;
  element.title = `${value.description} · ${fullResetTime(resetsAt, messages)}`;
  element.setAttribute("aria-label", element.title);
}

export function renderAccountResetTime(
  document: Document,
  value: string,
  messages: RendererSettingsMessages,
): HTMLElement | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const countdown = document.createElement("time");
  countdown.className =
    "min-w-0 truncate text-right text-[11px] tabular-nums whitespace-nowrap text-settings-muted";
  countdown.dateTime = date.toISOString();
  countdown.dataset.resetsAt = date.toISOString();
  updateCountdown(countdown, messages);
  return countdown;
}

/** The marker's inputs live on the meter so the page clock can move it without a rebuild. */
export function renderAccountPaceMarker(
  document: Document,
  meter: HTMLElement,
  window: AccountUsageWindowRow,
  display: AccountUsageDisplay,
  messages: RendererSettingsMessages,
): void {
  if (!window.windowMs || !window.resetsAt) return;
  meter.dataset.paceWindowMs = String(window.windowMs);
  meter.dataset.paceResetsAt = window.resetsAt;
  meter.dataset.paceUsed = String(window.usedPercent);
  meter.dataset.paceDisplay = display;
  const marker = document.createElement("span");
  marker.className = [
    "absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
    "bg-settings-text ring-2 ring-settings-panel data-[state=ahead]:bg-settings-warning",
  ].join(" ");
  marker.dataset.paceMarker = "";
  marker.setAttribute("aria-hidden", "true");
  meter.append(marker);
  updatePaceMarker(meter, marker, messages);
}

function updatePaceMarker(
  meter: HTMLElement,
  marker: HTMLElement,
  messages: RendererSettingsMessages,
): void {
  const display = meter.dataset.paceDisplay === "remaining" ? "remaining" : "used";
  const pace = accountUsagePace(
    {
      usedPercent: Number(meter.dataset.paceUsed),
      resetsAt: meter.dataset.paceResetsAt ?? "",
      windowMs: Number(meter.dataset.paceWindowMs),
    },
    display,
  );
  marker.hidden = !pace;
  if (!pace) {
    meter.title = "";
    return;
  }
  marker.style.left = `${pace.position}%`;
  marker.dataset.state = pace.ahead ? "ahead" : "even";
  const summary = (
    display === "remaining" ? messages.accountCreditsPaceRemaining : messages.accountCreditsPaceUsed
  ).replace("{percent}", `${Math.round(pace.position)}%`);
  meter.title = pace.ahead ? messages.accountCreditsPaceAhead.replace("{pace}", summary) : summary;
}

/** One page-local clock, no Host requests or list rebuilds (and no lost focus). */
export function mountAccountResetCountdowns(
  list: HTMLElement,
  messages: RendererSettingsMessages,
  signal: AbortSignal,
): () => void {
  const window = list.ownerDocument.defaultView;
  if (!window || signal.aborted) return () => undefined;
  const refresh = (): void => {
    if (signal.aborted) return;
    for (const element of list.querySelectorAll<HTMLElement>("[data-resets-at]")) {
      updateCountdown(element, messages);
    }
    for (const meter of list.querySelectorAll<HTMLElement>("[data-pace-window-ms]")) {
      const marker = meter.querySelector<HTMLElement>("[data-pace-marker]");
      if (marker) updatePaceMarker(meter, marker, messages);
    }
  };
  const timer = window.setInterval(refresh, 60_000);
  window.addEventListener("focus", refresh);
  const stop = (): void => {
    window.clearInterval(timer);
    window.removeEventListener("focus", refresh);
    signal.removeEventListener("abort", stop);
  };
  signal.addEventListener("abort", stop, { once: true });
  return stop;
}
