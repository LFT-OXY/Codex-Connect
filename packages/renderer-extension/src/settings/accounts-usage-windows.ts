import type { AccountCreditsSnapshot, AccountResetCredit } from "@codexhost/shared-contracts";

import type { RendererSettingsMessages } from "./localization.js";

export interface AccountUsageWindowRow {
  readonly label: string;
  readonly usedPercent: number;
  readonly resetsAt?: string;
  /** Only present when the source names a window of known length. */
  readonly windowMs?: number;
}

type AccountUsagePeriod = AccountCreditsSnapshot["periodType"];
export type AccountUsageWindowFilter = "all" | "weekly-only";
export type AccountUsageDisplay = "used" | "remaining";

const HOUR_MS = 3_600_000;
const PACE_MIN_USED_PERCENT = 5;
const PACE_AHEAD_MARGIN = 3;

function periodWindowMs(period: AccountUsagePeriod): number | undefined {
  if (period === "five_hour") return 5 * HOUR_MS;
  if (period === "seven_day" || period === "weekly") return 7 * 24 * HOUR_MS;
  return undefined;
}

export function creditsPeriodLabel(
  periodType: AccountUsagePeriod,
  messages: RendererSettingsMessages,
): string {
  if (periodType === "weekly") return messages.accountCreditsPeriodWeekly;
  if (periodType === "monthly") return messages.accountCreditsPeriodMonthly;
  if (periodType === "five_hour") return messages.accountCreditsPeriodFiveHour;
  if (periodType === "seven_day") return messages.accountCreditsPeriodSevenDay;
  return messages.accountCreditsPeriodUnknown;
}

export function creditsProductLabel(product: string, messages: RendererSettingsMessages): string {
  if (product === "GrokBuild" || product === "Build") return messages.accountCreditsBuild;
  if (product === "GrokChat") return "Chat";
  if (product === "GrokImagine") return "Imagine";
  if (product === "GrokVoice") return "Voice";
  return product;
}

const GENERIC_WINDOWS: Readonly<Record<string, AccountUsagePeriod>> = {
  "5-hour window": "five_hour",
  "7-day window": "seven_day",
  "Weekly window": "weekly",
};

const SCOPED_WINDOW_SUFFIXES: ReadonlyArray<readonly [string, AccountUsagePeriod]> = [
  [" · 5-hour window", "five_hour"],
  [" · Weekly window", "weekly"],
  [" · 7-day window", "seven_day"],
  [" · 5-hour", "five_hour"],
  [" · 7-day", "seven_day"],
];

/** Native product names carry the window only as English suffixes; unmatched names keep no period. */
function namedWindow(
  product: string,
  messages: RendererSettingsMessages,
): { label: string; period: AccountUsagePeriod | null; scope?: string } {
  const generic = GENERIC_WINDOWS[product];
  if (generic) return { label: creditsPeriodLabel(generic, messages), period: generic };
  for (const [suffix, period] of SCOPED_WINDOW_SUFFIXES) {
    if (!product.endsWith(suffix)) continue;
    const scope = product.slice(0, -suffix.length).trim();
    if (scope)
      return { label: `${scope} · ${creditsPeriodLabel(period, messages)}`, period, scope };
  }
  // Group unknown "<group> · <window>" names with their group, but never infer a length.
  const separator = product.lastIndexOf(" · ");
  const scope = separator > 0 ? product.slice(0, separator).trim() : "";
  return {
    label: creditsProductLabel(product, messages),
    period: null,
    ...(scope ? { scope } : {}),
  };
}

function windowRow(
  label: string,
  usedPercent: number,
  resetsAt: string | undefined,
  period: AccountUsagePeriod | null,
): AccountUsageWindowRow {
  const windowMs = period ? periodWindowMs(period) : undefined;
  return {
    label,
    usedPercent,
    ...(resetsAt ? { resetsAt } : {}),
    ...(windowMs ? { windowMs } : {}),
  };
}

export function accountUsageWindowRows(
  credits: AccountCreditsSnapshot,
  messages: RendererSettingsMessages,
  filter: AccountUsageWindowFilter = "all",
): AccountUsageWindowRow[] {
  const primary = credits.label ? namedWindow(credits.label, messages) : null;
  // Unscoped windows lead; each model/product group stays together in first-seen order.
  const groups = new Map<string, AccountUsageWindowRow[]>([["", []]]);
  const add = (
    scope: string | undefined,
    period: AccountUsagePeriod | null,
    row: AccountUsageWindowRow,
  ): void => {
    if (filter === "weekly-only" && period !== "seven_day" && period !== "weekly") return;
    const key = scope ?? "";
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  };
  const primaryPeriod = primary?.period ?? credits.periodType;
  add(
    primary?.scope,
    primaryPeriod,
    windowRow(
      primary?.label ?? creditsPeriodLabel(credits.periodType, messages),
      credits.usedPercent,
      credits.resetsAt,
      primaryPeriod,
    ),
  );
  for (const product of credits.productUsage ?? []) {
    const window = namedWindow(product.product, messages);
    add(
      window.scope,
      window.period,
      windowRow(window.label, product.usagePercent, product.resetsAt, window.period),
    );
  }
  return [...groups.values()].flat();
}

export interface AccountUsagePace {
  /** Marker position on the bar, in the same display mode as the fill. */
  readonly position: number;
  /** Actual use is more than the tolerated margin past an even pace. */
  readonly ahead: boolean;
}

export function accountUsagePace(
  window: Pick<AccountUsageWindowRow, "usedPercent" | "resetsAt" | "windowMs">,
  display: AccountUsageDisplay,
  now = Date.now(),
): AccountUsagePace | null {
  if (!window.windowMs || !window.resetsAt) return null;
  if (window.usedPercent < PACE_MIN_USED_PERCENT) return null;
  const resetsAt = Date.parse(window.resetsAt);
  if (!Number.isFinite(resetsAt)) return null;
  const elapsed = ((window.windowMs - (resetsAt - now)) / window.windowMs) * 100;
  const expected = Math.min(100, Math.max(0, elapsed));
  return {
    position: display === "remaining" ? 100 - expected : expected,
    ahead: window.usedPercent - expected > PACE_AHEAD_MARGIN,
  };
}

/** 发放→到期区间中尚未流逝的比例（0～100）；区间未知或无效时为 null。 */
export function accountResetCreditLife(
  credit: AccountResetCredit,
  now = Date.now(),
): number | null {
  if (!credit.grantedAt) return null;
  const grantedAt = Date.parse(credit.grantedAt);
  const expiresAt = Date.parse(credit.expiresAt);
  if (!Number.isFinite(grantedAt) || !Number.isFinite(expiresAt) || expiresAt <= grantedAt) {
    return null;
  }
  return Math.min(100, Math.max(0, ((expiresAt - now) / (expiresAt - grantedAt)) * 100));
}

export function accountResetCreditTone(expiresAt: number, now = Date.now()): "ok" | "warn" | "hot" {
  const remaining = expiresAt - now;
  if (remaining <= 8 * HOUR_MS) return "hot";
  if (remaining <= 24 * HOUR_MS) return "warn";
  return "ok";
}
