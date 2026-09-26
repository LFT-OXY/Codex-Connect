import { z } from "zod";

import {
  HARNESS_SESSION_IMPORT_CWD_MAX_LENGTH,
  HARNESS_SESSION_IMPORT_TITLE_MAX_LENGTH,
  harnessSessionImportIdSchema,
} from "./harness-session-import.js";
import { harnessPluginIdSchema } from "./harness-plugins.js";
import { hostThreadIdSchema } from "./ids.js";
import {
  LOCAL_USAGE_HARNESS_MAX_LENGTH,
  LOCAL_USAGE_HARNESS_NAME_MAX_LENGTH,
  LOCAL_USAGE_PROJECT_NAME_MAX_LENGTH,
  localUsageReadingSchema,
} from "./local-usage.js";

export const LOCAL_SESSIONS_QUERY_METHOD = "codexhost/sessions/query";
/** Per-response wire bound; filtering and paging happen in Renderer. */
export const LOCAL_SESSIONS_MAX_LENGTH = 100_000;
export const LOCAL_SESSIONS_MODEL_MAX_LENGTH = 1_024;

const countSchema = z.number().int().nonnegative().safe();
const timeSchema = countSchema;
const sessionHarnessIdSchema = z.union([z.literal("codex"), harnessPluginIdSchema]);
const harnessNameSchema = z.string().trim().min(1).max(LOCAL_USAGE_HARNESS_NAME_MAX_LENGTH);

export const localSessionsQueryParamsSchema = z.strictObject({
  /** Read native records added since the last read before answering. */
  refresh: z.boolean(),
});

/** One main Session with its subagents folded in. It never carries message text. */
export const localSessionSchema = z.strictObject({
  harnessId: sessionHarnessIdSchema,
  nativeSessionId: harnessSessionImportIdSchema,
  /** The Harness's own name for the Session; null shows the project instead. */
  title: z.string().min(1).max(HARNESS_SESSION_IMPORT_TITLE_MAX_LENGTH).nullable(),
  /** Working directory, used to copy the project path or a resume command. */
  cwd: z.string().min(1).max(HARNESS_SESSION_IMPORT_CWD_MAX_LENGTH).nullable(),
  /** `owner/repo` from the Git remote, otherwise the folder name. */
  project: z.string().min(1).max(LOCAL_USAGE_PROJECT_NAME_MAX_LENGTH).nullable(),
  model: z.string().min(1).max(LOCAL_SESSIONS_MODEL_MAX_LENGTH).nullable(),
  startedAt: timeSchema.nullable(),
  lastActivityAt: timeSchema,
  /** Null for Sessions known only from Session import, which has no native usage. */
  activeMs: countSchema.nullable(),
  usage: z
    .strictObject({
      /** Includes folded subagents. */
      totalTokens: countSchema,
      estimatedCostUsd: z.number().nonnegative().finite(),
    })
    .nullable(),
  turns: countSchema.nullable(),
  edits: countSchema.nullable(),
  /** Subagent and child Sessions folded into this one. */
  subagents: countSchema,
  /** The Thread this Session is already mapped to. */
  threadId: hostThreadIdSchema.nullable(),
  /** Whether Resume can open it as a Thread. */
  resumable: z.boolean(),
  /** Null when the Harness cannot tell whether another client is running it. */
  running: z.boolean().nullable(),
});

export const localSessionsViewSchema = z.strictObject({
  status: z.literal("ready"),
  /** Most recently active first. */
  sessions: z.array(localSessionSchema).max(LOCAL_SESSIONS_MAX_LENGTH),
  /** Subagent and child Sessions folded into listed Sessions. */
  foldedSubagents: countSchema,
  /** Harnesses with listed Sessions. */
  harnesses: z
    .array(z.strictObject({ harnessId: sessionHarnessIdSchema, name: harnessNameSchema }))
    .max(LOCAL_USAGE_HARNESS_MAX_LENGTH),
  /** Sources whose last read failed; their Sessions are from their last successful read. */
  failures: z
    .array(z.strictObject({ harnessId: sessionHarnessIdSchema, name: harnessNameSchema }))
    .max(LOCAL_USAGE_HARNESS_MAX_LENGTH),
});

export const localSessionsQueryResultSchema = z.discriminatedUnion("status", [
  localUsageReadingSchema,
  localSessionsViewSchema,
]);

export type LocalSession = z.infer<typeof localSessionSchema>;
export type LocalSessionsQueryParams = z.infer<typeof localSessionsQueryParamsSchema>;
export type LocalSessionsView = z.infer<typeof localSessionsViewSchema>;
export type LocalSessionsQueryResult = z.infer<typeof localSessionsQueryResultSchema>;
