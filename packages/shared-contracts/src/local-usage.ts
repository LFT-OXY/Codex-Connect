import { z } from "zod";

import { harnessPluginIdSchema } from "./harness-plugins.js";

export const LOCAL_USAGE_QUERY_METHOD = "codexhost/usage/query";
/** A custom range is bounded so one response stays bounded. */
export const LOCAL_USAGE_CUSTOM_RANGE_MAX_DAYS = 3_660;
export const LOCAL_USAGE_DAILY_MAX_LENGTH = LOCAL_USAGE_CUSTOM_RANGE_MAX_DAYS + 1;
export const LOCAL_USAGE_HARNESS_MAX_LENGTH = 128;
export const LOCAL_USAGE_PROVIDER_MAX_LENGTH = 128;
export const LOCAL_USAGE_PROVIDER_NAME_MAX_LENGTH = 1_024;
export const LOCAL_USAGE_TIME_ZONE_MAX_LENGTH = 64;

const DAY_MS = 86_400_000;

function dateValue(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

/** Calendar date in the requester's time zone, `YYYY-MM-DD`. */
export const localUsageDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const time = dateValue(value);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }, "Invalid calendar date");

const timeZoneSchema = z
  .string()
  .min(1)
  .max(LOCAL_USAGE_TIME_ZONE_MAX_LENGTH)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone");

export const localUsagePeriodSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("day") }),
  // Weeks start on Monday.
  z.strictObject({ kind: z.literal("week") }),
  z.strictObject({ kind: z.literal("month") }),
  // The first day of the month 23 months ago through today.
  z.strictObject({ kind: z.literal("total") }),
  z
    .strictObject({
      kind: z.literal("custom"),
      from: localUsageDateSchema,
      to: localUsageDateSchema,
    })
    .superRefine((period, context) => {
      const days = (dateValue(period.to) - dateValue(period.from)) / DAY_MS;
      if (days < 0) {
        context.addIssue({ code: "custom", path: ["to"], message: "Range ends before it starts" });
      } else if (days >= LOCAL_USAGE_CUSTOM_RANGE_MAX_DAYS) {
        context.addIssue({ code: "custom", path: ["to"], message: "Range is too long" });
      }
    }),
]);

export const localUsageQueryParamsSchema = z.strictObject({
  period: localUsagePeriodSchema,
  /** IANA zone used to assign usage to calendar days. */
  timeZone: timeZoneSchema,
  /** Read new native records before answering; otherwise reuse this Host's last read. */
  refresh: z.boolean(),
});

const countSchema = z.number().int().nonnegative().safe();

const tokenTotalsShape = {
  total: countSchema,
  /** Input tokens excluding cache reads and writes. */
  input: countSchema,
  cacheRead: countSchema,
  cacheWrite: countSchema,
  output: countSchema,
  reasoning: countSchema,
};

/** Aggregate numbers only. Message text and native identities never cross this boundary. */
export const localUsageQueryResultSchema = z.strictObject({
  range: z.strictObject({ from: localUsageDateSchema, to: localUsageDateSchema }),
  totals: z
    .strictObject({ ...tokenTotalsShape, conversations: countSchema })
    .refine(
      (totals) =>
        totals.total ===
        totals.input + totals.cacheRead + totals.cacheWrite + totals.output + totals.reasoning,
      { path: ["total"], message: "Total must equal its parts" },
    ),
  /**
   * Estimated Cost of the range in USD: Harness-reported cost where present, otherwise public
   * model prices applied when queried. Models without a price add 0.
   */
  estimatedCostUsd: z.number().nonnegative().finite(),
  /** Distinct Models with usage in the range, across Harnesses. */
  models: countSchema,
  harnesses: z
    .array(
      z
        .strictObject({
          /** Official Codex or an installed Harness plugin. */
          harnessId: z.union([z.literal("codex"), harnessPluginIdSchema]),
          name: z.string().trim().min(1).max(128),
          totalTokens: countSchema,
          models: countSchema,
          /** Providers the Harness recorded, by usage; empty when it records none. */
          providers: z
            .array(
              z.strictObject({
                provider: z.string().min(1).max(LOCAL_USAGE_PROVIDER_NAME_MAX_LENGTH),
                totalTokens: countSchema,
                models: countSchema,
              }),
            )
            .max(LOCAL_USAGE_PROVIDER_MAX_LENGTH),
        })
        .refine(
          (harness) =>
            harness.providers.reduce((sum, provider) => sum + provider.totalTokens, 0) <=
            harness.totalTokens,
          { path: ["providers"], message: "Providers are part of their Harness" },
        ),
    )
    .max(LOCAL_USAGE_HARNESS_MAX_LENGTH),
  /** Days with usage, newest first. `cacheRead` is the daily cache column. */
  daily: z
    .array(
      z.strictObject({
        date: localUsageDateSchema,
        total: countSchema,
        input: countSchema,
        output: countSchema,
        cacheRead: countSchema,
        reasoning: countSchema,
        conversations: countSchema,
      }),
    )
    .max(LOCAL_USAGE_DAILY_MAX_LENGTH),
  /**
   * Independent of the selected period. Windows end today; an active day has tokens.
   * `dailyAverage` is the last 30 days' total over their active days, rounded.
   */
  stats: z
    .strictObject({
      last7Days: countSchema,
      last30Days: countSchema,
      dailyAverage: countSchema,
      /** Active days across all counted history, not only the "total" period. */
      activeDays: countSchema,
      firstActiveDate: localUsageDateSchema.nullable(),
    })
    .superRefine((stats, context) => {
      if ((stats.firstActiveDate === null) !== (stats.activeDays === 0)) {
        context.addIssue({
          code: "custom",
          path: ["firstActiveDate"],
          message: "First active date exists exactly when there are active days",
        });
      }
      if (stats.last7Days > stats.last30Days) {
        context.addIssue({
          code: "custom",
          path: ["last7Days"],
          message: "The last 7 days are part of the last 30 days",
        });
      }
    }),
});

export type LocalUsagePeriod = z.infer<typeof localUsagePeriodSchema>;
export type LocalUsageQueryParams = z.infer<typeof localUsageQueryParamsSchema>;
export type LocalUsageQueryResult = z.infer<typeof localUsageQueryResultSchema>;
