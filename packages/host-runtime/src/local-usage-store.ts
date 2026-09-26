import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { HarnessNativeUsageBatch } from "@codexhost/harness-adapter";
import { jsonValueSchema } from "@codexhost/shared-contracts";
import { z } from "zod";

const HALF_HOUR_MS = 30 * 60_000;
const countSchema = z.number().int().nonnegative().safe();
const textSchema = z.string().min(1).max(1_024);
const cwdSchema = z.string().max(16_384);
const titleSchema = z.string().min(1).max(4_096);

const sessionSummaryFields = {
  nativeSessionId: textSchema,
  firstActivityAt: countSchema,
  lastActivityAt: countSchema,
  activeMs: countSchema,
  turns: countSchema,
  edits: countSchema,
};

/** Adapter output is plugin data; Host checks it before counting anything. */
const nativeUsageBatchSchema = z.strictObject({
  records: z.array(
    z.strictObject({
      dedupeKey: textSchema,
      occurredAt: z.number().int().nonnegative().safe(),
      nativeSessionId: textSchema,
      provider: textSchema.optional(),
      model: textSchema.optional(),
      cwd: z.string().max(16_384).optional(),
      tokens: z
        .strictObject({
          input: countSchema,
          cacheRead: countSchema,
          cacheWrite: countSchema,
          cacheWrite1h: countSchema.optional(),
          output: countSchema,
          reasoning: countSchema,
        })
        .refine((tokens) => (tokens.cacheWrite1h ?? 0) <= tokens.cacheWrite, {
          path: ["cacheWrite1h"],
          message: "One-hour cache writes are part of cache writes",
        }),
      conversations: countSchema,
      reportedCostUsd: z.number().nonnegative().finite().optional(),
    }),
  ),
  sessions: z
    .array(
      z.strictObject({
        ...sessionSummaryFields,
        key: textSchema,
        parentSessionId: textSchema.optional(),
        title: titleSchema.optional(),
        cwd: cwdSchema.optional(),
        model: textSchema.optional(),
      }),
    )
    .optional(),
  cursor: jsonValueSchema,
});

const bucketSchema = z.strictObject({
  /** UTC half-hour start, epoch milliseconds. */
  start: countSchema,
  harnessId: textSchema,
  provider: textSchema.nullable(),
  model: textSchema.nullable(),
  /** Native working directory; project identity is derived from it when queried. */
  cwd: z.string().max(16_384).nullable(),
  input: countSchema,
  cacheRead: countSchema,
  cacheWrite: countSchema,
  /** Part of `cacheWrite` written to a one-hour cache. */
  cacheWrite1h: countSchema,
  output: countSchema,
  reasoning: countSchema,
  conversations: countSchema,
  /** Present only in buckets of records whose Harness reported their cost. */
  reportedCostUsd: z.number().nonnegative().finite().optional(),
});

const usageFields = {
  input: countSchema,
  cacheRead: countSchema,
  cacheWrite: countSchema,
  /** Part of `cacheWrite` written to a one-hour cache. */
  cacheWrite1h: countSchema,
  output: countSchema,
  reasoning: countSchema,
};

/** The latest summary of one unit of native records, such as one file. */
const sessionSummarySchema = z.strictObject({
  ...sessionSummaryFields,
  harnessId: textSchema,
  key: textSchema,
  parentSessionId: textSchema.nullable(),
  title: titleSchema.nullable(),
  cwd: cwdSchema.nullable(),
  model: textSchema.nullable(),
});

/** Usage of one Native Session with one model, priced when queried like buckets are. */
const sessionUsageSchema = z.strictObject({
  harnessId: textSchema,
  nativeSessionId: textSchema,
  provider: textSchema.nullable(),
  model: textSchema.nullable(),
  ...usageFields,
  reportedCostUsd: z.number().nonnegative().finite().optional(),
});

const localUsageStateSchema = z.strictObject({
  // Version 1 had no one-hour cache writes and version 2 no Sessions; older files are rebuilt.
  formatVersion: z.literal(3),
  sources: z.record(
    textSchema,
    z.strictObject({
      cursor: jsonValueSchema.nullable(),
      /** Short hashes of counted dedupe keys; keys themselves stay in native records. */
      counted: z.array(z.string()),
    }),
  ),
  buckets: z.array(bucketSchema),
  sessions: z.array(sessionSummarySchema),
  sessionUsage: z.array(sessionUsageSchema),
});

export type LocalUsageBucket = z.infer<typeof bucketSchema>;
export type LocalSessionSummary = z.infer<typeof sessionSummarySchema>;
export type LocalSessionUsage = z.infer<typeof sessionUsageSchema>;
export type LocalUsageState = z.infer<typeof localUsageStateSchema>;

export function emptyLocalUsageState(): LocalUsageState {
  return { formatVersion: 3, sources: {}, buckets: [], sessions: [], sessionUsage: [] };
}

export function defaultLocalUsageDirectory(environment: NodeJS.ProcessEnv): string {
  return path.join(
    environment.CODEXHOST_DATA_DIR
      ? path.resolve(environment.CODEXHOST_DATA_DIR)
      : path.join(os.homedir(), ".codexhost"),
    "usage",
  );
}

function stateFile(directory: string): string {
  return path.join(directory, "local-usage.json");
}

/** Returns null when nothing has been read yet. A damaged file starts over from native records. */
export async function loadLocalUsageState(
  directory: string,
  diagnose: (error: unknown) => void,
): Promise<LocalUsageState | null> {
  let raw: string;
  try {
    raw = await readFile(stateFile(directory), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  try {
    return localUsageStateSchema.parse(JSON.parse(raw));
  } catch {
    diagnose(
      new Error("Local usage state is unreadable or outdated; rebuilding it from native records"),
    );
    return null;
  }
}

/** Replaces `file` in the usage directory atomically; readable by the owner only. */
export async function writeUsageFile(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function saveLocalUsageState(
  directory: string,
  state: LocalUsageState,
): Promise<void> {
  await writeUsageFile(stateFile(directory), state);
}

function countedKey(dedupeKey: string): string {
  return createHash("sha256").update(dedupeKey).digest("base64url").slice(0, 16);
}

function bucketKey(
  bucket: Pick<LocalUsageBucket, "start" | "harnessId" | "provider" | "model" | "cwd">,
  costReported: boolean,
): string {
  return JSON.stringify([
    bucket.start,
    bucket.harnessId,
    bucket.provider,
    bucket.model,
    bucket.cwd,
    costReported,
  ]);
}

function sessionUsageKey(
  usage: Pick<
    LocalSessionUsage,
    "harnessId" | "nativeSessionId" | "provider" | "model" | "reportedCostUsd"
  >,
): string {
  return JSON.stringify([
    usage.harnessId,
    usage.nativeSessionId,
    usage.provider,
    usage.model,
    usage.reportedCostUsd !== undefined,
  ]);
}

/**
 * Adds one validated batch to `state`, counting each dedupe key once per Harness.
 * Throws before changing `state` when the batch is malformed.
 */
export function applyNativeUsageBatch(
  state: LocalUsageState,
  harnessId: string,
  batch: HarnessNativeUsageBatch,
): void {
  const { records, sessions, cursor } = nativeUsageBatchSchema.parse(batch);
  const counted = new Set(state.sources[harnessId]?.counted);
  const buckets = new Map(
    state.buckets.map((bucket) => [
      bucketKey(bucket, bucket.reportedCostUsd !== undefined),
      bucket,
    ]),
  );
  const sessionUsage = new Map(state.sessionUsage.map((usage) => [sessionUsageKey(usage), usage]));
  for (const record of records) {
    const key = countedKey(record.dedupeKey);
    if (counted.has(key)) continue;
    counted.add(key);
    const identity = {
      start: Math.floor(record.occurredAt / HALF_HOUR_MS) * HALF_HOUR_MS,
      harnessId,
      provider: record.provider ?? null,
      model: record.model ?? null,
      cwd: record.cwd ?? null,
    };
    // Reported and priced usage stay in separate buckets so each is costed its own way.
    const id = bucketKey(identity, record.reportedCostUsd !== undefined);
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = {
        ...identity,
        input: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cacheWrite1h: 0,
        output: 0,
        reasoning: 0,
        conversations: 0,
        ...(record.reportedCostUsd === undefined ? {} : { reportedCostUsd: 0 }),
      };
      buckets.set(id, bucket);
      state.buckets.push(bucket);
    }
    bucket.input += record.tokens.input;
    bucket.cacheRead += record.tokens.cacheRead;
    bucket.cacheWrite += record.tokens.cacheWrite;
    bucket.cacheWrite1h += record.tokens.cacheWrite1h ?? 0;
    bucket.output += record.tokens.output;
    bucket.reasoning += record.tokens.reasoning;
    bucket.conversations += record.conversations;
    if (bucket.reportedCostUsd !== undefined) {
      bucket.reportedCostUsd += record.reportedCostUsd ?? 0;
    }
    const usageIdentity = {
      harnessId,
      nativeSessionId: record.nativeSessionId,
      provider: identity.provider,
      model: identity.model,
      ...(record.reportedCostUsd === undefined ? {} : { reportedCostUsd: 0 }),
    };
    const usageId = sessionUsageKey(usageIdentity);
    let usage = sessionUsage.get(usageId);
    if (!usage) {
      usage = {
        ...usageIdentity,
        input: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cacheWrite1h: 0,
        output: 0,
        reasoning: 0,
      };
      sessionUsage.set(usageId, usage);
      state.sessionUsage.push(usage);
    }
    usage.input += record.tokens.input;
    usage.cacheRead += record.tokens.cacheRead;
    usage.cacheWrite += record.tokens.cacheWrite;
    usage.cacheWrite1h += record.tokens.cacheWrite1h ?? 0;
    usage.output += record.tokens.output;
    usage.reasoning += record.tokens.reasoning;
    if (usage.reportedCostUsd !== undefined) usage.reportedCostUsd += record.reportedCostUsd ?? 0;
  }
  if (sessions?.length) {
    // A summary replaces the previous one of the same records.
    const replaced = new Set(sessions.map(({ key }) => key));
    state.sessions = state.sessions.filter(
      (summary) => summary.harnessId !== harnessId || !replaced.has(summary.key),
    );
    for (const summary of sessions) {
      state.sessions.push({
        harnessId,
        key: summary.key,
        nativeSessionId: summary.nativeSessionId,
        parentSessionId: summary.parentSessionId ?? null,
        title: summary.title ?? null,
        cwd: summary.cwd ?? null,
        model: summary.model ?? null,
        firstActivityAt: summary.firstActivityAt,
        lastActivityAt: summary.lastActivityAt,
        activeMs: summary.activeMs,
        turns: summary.turns,
        edits: summary.edits,
      });
    }
  }
  state.sources[harnessId] = { cursor, counted: [...counted] };
}
