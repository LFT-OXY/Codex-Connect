import {
  harnessPluginIdSchema,
  type LocalUsagePeriod,
  type LocalUsageQueryResult,
} from "@codexhost/shared-contracts";

import type { LocalUsageBucket } from "./local-usage-store.js";

type DailyRow = LocalUsageQueryResult["daily"][number];

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
}): LocalUsageQueryResult {
  const localDate = localDateFormatter(input.timeZone);
  const range = localUsageRange(input.period, localDate(input.now));
  const totals = {
    total: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    reasoning: 0,
    conversations: 0,
  };
  const models = new Set<string>();
  const harnesses = new Map<string, { totalTokens: number; models: Set<string> }>();
  const daily = new Map<string, DailyRow>();
  for (const bucket of input.buckets) {
    const date = localDate(bucket.start);
    if (date < range.from || date > range.to) continue;
    const total = tokenTotal(bucket);
    totals.total += total;
    totals.input += bucket.input;
    totals.cacheRead += bucket.cacheRead;
    totals.cacheWrite += bucket.cacheWrite;
    totals.output += bucket.output;
    totals.reasoning += bucket.reasoning;
    totals.conversations += bucket.conversations;
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
      harness = { totalTokens: 0, models: new Set() };
      harnesses.set(bucket.harnessId, harness);
    }
    harness.totalTokens += total;
    if (bucket.model !== null) {
      harness.models.add(bucket.model);
      models.add(JSON.stringify([bucket.harnessId, bucket.model]));
    }
  }
  return {
    range,
    totals,
    models: models.size,
    harnesses: [...harnesses]
      .map(([harnessId, harness]) => ({
        harnessId: harnessPluginIdSchema.parse(harnessId),
        name: input.harnessName(harnessId),
        totalTokens: harness.totalTokens,
        models: harness.models.size,
      }))
      .sort((left, right) => right.totalTokens - left.totalTokens),
    daily: [...daily.values()].sort((left, right) => right.date.localeCompare(left.date)),
  };
}
