import {
  harnessIdSchema,
  LOCAL_USAGE_PROJECT_MAX_LENGTH,
  type LocalUsagePeriod,
  type LocalUsageView,
} from "@codexhost/shared-contracts";

import { usageCostUsd, type ModelPricer } from "./local-usage-pricing.js";
import type { LocalUsageBucket } from "./local-usage-store.js";

type DailyRow = LocalUsageView["daily"][number];

function calendarDate(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function dateParts(date: string): { year: number; monthIndex: number; day: number } {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return { year, monthIndex: month - 1, day };
}

function localDateFormatter(timeZone: string): (time: number) => string {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return (time) => {
    const parts = Object.fromEntries(
      format.formatToParts(time).map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
}

/** Inclusive calendar range; weeks start on Monday and "total" covers the last 24 months. */
export function localUsageRange(
  period: LocalUsagePeriod,
  today: string,
): { from: string; to: string } {
  const { year, monthIndex, day } = dateParts(today);
  switch (period.kind) {
    case "day":
      return { from: today, to: today };
    case "week": {
      const weekday = (new Date(Date.UTC(year, monthIndex, day)).getUTCDay() + 6) % 7;
      return {
        from: calendarDate(year, monthIndex, day - weekday),
        to: calendarDate(year, monthIndex, day - weekday + 6),
      };
    }
    case "month":
      return { from: calendarDate(year, monthIndex, 1), to: calendarDate(year, monthIndex + 1, 0) };
    case "total":
      return { from: calendarDate(year, monthIndex - 23, 1), to: today };
    case "custom":
      return { from: period.from, to: period.to };
  }
}

function shiftDate(date: string, days: number): string {
  const { year, monthIndex, day } = dateParts(date);
  return calendarDate(year, monthIndex, day + days);
}

/** Rolling windows end today; only days with tokens count as active, never days after today. */
function usageStats(
  dayTotals: ReadonlyMap<string, number>,
  today: string,
): LocalUsageView["stats"] {
  const last7From = shiftDate(today, -6);
  const last30From = shiftDate(today, -29);
  const stats: LocalUsageView["stats"] = {
    last7Days: 0,
    last30Days: 0,
    dailyAverage: 0,
    activeDays: 0,
    firstActiveDate: null,
  };
  let activeDaysIn30 = 0;
  for (const [date, total] of dayTotals) {
    if (total === 0 || date > today) continue;
    stats.activeDays += 1;
    if (stats.firstActiveDate === null || date < stats.firstActiveDate) {
      stats.firstActiveDate = date;
    }
    if (date >= last30From) {
      stats.last30Days += total;
      activeDaysIn30 += 1;
    }
    if (date >= last7From) stats.last7Days += total;
  }
  if (activeDaysIn30 > 0) stats.dailyAverage = Math.round(stats.last30Days / activeDaysIn30);
  return stats;
}

function tokenTotal(bucket: LocalUsageBucket): number {
  return bucket.input + bucket.cacheRead + bucket.cacheWrite + bucket.output + bucket.reasoning;
}

/** Aggregates half-hour buckets into the page view, assigning each bucket to a local day. */
export function buildLocalUsageView(input: {
  buckets: readonly LocalUsageBucket[];
  period: LocalUsagePeriod;
  timeZone: string;
  now: number;
  harnessName(harnessId: string): string;
  price: ModelPricer;
  /** Project name of a working directory in `buckets`. */
  project(cwd: string): string | undefined;
  /** Harnesses whose last read failed. */
  failedHarnessIds: readonly string[];
}): LocalUsageView {
  const localDate = localDateFormatter(input.timeZone);
  const today = localDate(input.now);
  const range = localUsageRange(input.period, today);
  const totals = {
    total: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
    conversations: 0,
  };
  let estimatedCostUsd = 0;
  const models = new Set<string>();
  const harnesses = new Map<
    string,
    {
      totalTokens: number;
      models: Set<string>;
      providers: Map<string, { totalTokens: number; models: Set<string> }>;
    }
  >();
  const projects = new Map<string, { totalTokens: number; harnesses: Map<string, number> }>();
  const daily = new Map<string, DailyRow>();
  const dayTotals = new Map<string, number>();
  for (const bucket of input.buckets) {
    const date = localDate(bucket.start);
    const total = tokenTotal(bucket);
    dayTotals.set(date, (dayTotals.get(date) ?? 0) + total);
    if (date < range.from || date > range.to) continue;
    totals.total += total;
    totals.input += bucket.input;
    totals.cacheRead += bucket.cacheRead;
    totals.cacheWrite += bucket.cacheWrite;
    totals.output += bucket.output;
    totals.reasoning += bucket.reasoning;
    totals.conversations += bucket.conversations;
    // Priced now rather than when read, so updated prices apply to earlier usage too.
    estimatedCostUsd +=
      bucket.reportedCostUsd ??
      (bucket.model === null ? 0 : usageCostUsd(bucket, input.price(bucket.model)));
    let row = daily.get(date);
    if (!row) {
      row = { date, total: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0, conversations: 0 };
      daily.set(date, row);
    }
    row.total += total;
    row.input += bucket.input;
    row.output += bucket.output;
    row.cacheRead += bucket.cacheRead;
    row.reasoning += bucket.reasoning;
    row.conversations += bucket.conversations;
    if (total === 0) continue;
    let harness = harnesses.get(bucket.harnessId);
    if (!harness) {
      harness = { totalTokens: 0, models: new Set(), providers: new Map() };
      harnesses.set(bucket.harnessId, harness);
    }
    harness.totalTokens += total;
    if (bucket.model !== null) {
      harness.models.add(bucket.model);
      models.add(JSON.stringify([bucket.harnessId, bucket.model]));
    }
    const name = bucket.cwd ? input.project(bucket.cwd) : undefined;
    if (name !== undefined) {
      let project = projects.get(name);
      if (!project) {
        project = { totalTokens: 0, harnesses: new Map() };
        projects.set(name, project);
      }
      project.totalTokens += total;
      project.harnesses.set(
        bucket.harnessId,
        (project.harnesses.get(bucket.harnessId) ?? 0) + total,
      );
    }
    if (bucket.provider === null) continue;
    let provider = harness.providers.get(bucket.provider);
    if (!provider) {
      provider = { totalTokens: 0, models: new Set() };
      harness.providers.set(bucket.provider, provider);
    }
    provider.totalTokens += total;
    if (bucket.model !== null) provider.models.add(bucket.model);
  }
  return {
    status: "ready",
    range,
    totals,
    estimatedCostUsd,
    models: models.size,
    harnesses: [...harnesses]
      .map(([harnessId, harness]) => ({
        harnessId: harnessIdSchema.parse(harnessId),
        name: input.harnessName(harnessId),
        totalTokens: harness.totalTokens,
        models: harness.models.size,
        providers: [...harness.providers]
          .map(([provider, usage]) => ({
            provider,
            totalTokens: usage.totalTokens,
            models: usage.models.size,
          }))
          .sort((left, right) => right.totalTokens - left.totalTokens),
      }))
      .sort((left, right) => right.totalTokens - left.totalTokens),
    daily: [...daily.values()].sort((left, right) => right.date.localeCompare(left.date)),
    projects: [...projects]
      .map(([project, usage]) => ({
        project,
        totalTokens: usage.totalTokens,
        harnessIds: [...usage.harnesses]
          .sort((left, right) => right[1] - left[1])
          .map(([harnessId]) => harnessIdSchema.parse(harnessId)),
      }))
      .sort((left, right) => right.totalTokens - left.totalTokens)
      .slice(0, LOCAL_USAGE_PROJECT_MAX_LENGTH),
    failures: input.failedHarnessIds.map((harnessId) => ({
      harnessId: harnessIdSchema.parse(harnessId),
      name: input.harnessName(harnessId),
    })),
    stats: usageStats(dayTotals, today),
  };
}
