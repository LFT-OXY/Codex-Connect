import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type {
  HarnessNativeUsageBatch,
  HarnessNativeUsageCapability,
  HarnessNativeUsageRecord,
} from "@codexhost/harness-adapter";
import type { JsonValue } from "@codexhost/shared-contracts";
import { z } from "zod";

const NEWLINE = 0x0a;
const ROLLOUT_DIRECTORIES = ["sessions", "archived_sessions"] as const;
const ROLLOUT_NAME = /^rollout-.*\.jsonl$/u;
const countSchema = z.number().int().nonnegative().safe();

/** Codex's cumulative token usage: cached and cache-written input are part of `input`. */
const codexUsageSchema = z.strictObject({
  input: countSchema,
  cached: countSchema,
  cacheWrite: countSchema,
  output: countSchema,
  reasoning: countSchema,
});

type CodexUsage = z.infer<typeof codexUsageSchema>;

/** What a rollout has declared so far; later lines are read in its context. */
const rolloutStateSchema = z.strictObject({
  sessionId: z.string().nullable(),
  /** Session whose history the following lines belong to; a fork replays its parent's. */
  historyId: z.string().nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  cwd: z.string().nullable(),
  total: codexUsageSchema.nullable(),
});

type RolloutState = z.infer<typeof rolloutStateSchema>;

const codexUsageCursorSchema = z.strictObject({
  formatVersion: z.literal(1),
  /** Keyed by path relative to CODEX_HOME. */
  files: z.record(
    z.string(),
    z.strictObject({
      ino: z.string(),
      offset: countSchema,
      state: rolloutStateSchema,
    }),
  ),
});

type CodexUsageCursor = z.infer<typeof codexUsageCursorSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function missing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function emptyState(): RolloutState {
  return { sessionId: null, historyId: null, provider: null, model: null, cwd: null, total: null };
}

function codexUsage(value: unknown): CodexUsage | null {
  if (!isRecord(value)) return null;
  return {
    input: count(value.input_tokens),
    cached: count(value.cached_input_tokens),
    cacheWrite: count(value.cache_write_input_tokens),
    output: count(value.output_tokens),
    reasoning: count(value.reasoning_output_tokens),
  };
}

const USAGE_FIELDS = ["input", "cached", "cacheWrite", "output", "reasoning"] as const;

function signature(usage: CodexUsage | null): string {
  return usage ? USAGE_FIELDS.map((field) => usage[field]).join(".") : "-";
}

/**
 * Usage since the previous count. Codex writes running totals; when they restart (a fork that
 * did not inherit them, a resumed session, or no earlier count in this file) the event's own last
 * usage is the delta. A restarted total equals that last usage even when it exceeds the previous.
 */
function usageDelta(
  total: CodexUsage,
  last: CodexUsage | null,
  previous: CodexUsage | null,
): CodexUsage {
  // Codex repeats unchanged totals, for example alongside rate limit updates.
  if (previous && signature(total) === signature(previous)) {
    return { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 };
  }
  if (
    previous &&
    signature(total) !== signature(last) &&
    USAGE_FIELDS.every((field) => total[field] >= previous[field])
  ) {
    return {
      input: total.input - previous.input,
      cached: total.cached - previous.cached,
      cacheWrite: total.cacheWrite - previous.cacheWrite,
      output: total.output - previous.output,
      reasoning: total.reasoning - previous.reasoning,
    };
  }
  return last ?? total;
}

/** Rollouts sorted by file name, which starts with the creation time: parents precede forks. */
async function rolloutFiles(codexHome: string): Promise<string[]> {
  const files: string[] = [];
  for (const directory of ROLLOUT_DIRECTORIES) {
    let entries: string[];
    try {
      entries = await readdir(path.join(codexHome, directory), { recursive: true });
    } catch (error) {
      if (missing(error)) continue;
      throw error;
    }
    for (const entry of entries) {
      if (ROLLOUT_NAME.test(path.basename(entry))) files.push(path.join(directory, entry));
    }
  }
  return files.sort(
    (left, right) =>
      path.basename(left).localeCompare(path.basename(right)) || left.localeCompare(right),
  );
}

/** Complete lines from `start`, with absolute byte offsets. A trailing partial line is left unread. */
async function* completeLines(
  file: string,
  start: number,
  end: number,
): AsyncGenerator<{ line: string; end: number }> {
  if (end <= start) return;
  let carry: Buffer = Buffer.alloc(0);
  let carryStart = start;
  for await (const chunk of createReadStream(file, { start, end: end - 1 })) {
    const buffer = carry.length > 0 ? Buffer.concat([carry, chunk as Buffer]) : (chunk as Buffer);
    let lineStart = 0;
    let newline = buffer.indexOf(NEWLINE, lineStart);
    while (newline !== -1) {
      yield { line: buffer.toString("utf8", lineStart, newline), end: carryStart + newline + 1 };
      lineStart = newline + 1;
      newline = buffer.indexOf(NEWLINE, lineStart);
    }
    carry = buffer.subarray(lineStart);
    carryStart += lineStart;
  }
}

/** Advances the rollout's running total and returns the usage the count added, if any. */
function consumeTokenCount(
  state: RolloutState,
  timestamp: unknown,
  info: Record<string, unknown>,
): HarnessNativeUsageRecord | null {
  const total = codexUsage(info.total_token_usage);
  if (!total) return null;
  const last = codexUsage(info.last_token_usage);
  const delta = usageDelta(total, last, state.total);
  state.total = total;
  const time = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
  const historyId = state.historyId ?? state.sessionId;
  if (!state.sessionId || !historyId || !Number.isFinite(time)) return null;
  // Codex's input includes cached and cache-written tokens, and output includes reasoning.
  const cacheRead = Math.min(delta.cached, delta.input);
  const cacheWrite = Math.min(delta.cacheWrite, delta.input - cacheRead);
  const tokens = {
    input: delta.input - cacheRead - cacheWrite,
    cacheRead,
    cacheWrite,
    output: delta.output,
    reasoning: 0,
  };
  if (tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output === 0) return null;
  return {
    // Running totals only grow within a history, so a fork's replayed copy keeps the same key.
    dedupeKey: `token_count:${historyId}:${signature(total)}:${signature(last)}`,
    occurredAt: time,
    nativeSessionId: state.sessionId,
    ...(state.provider ? { provider: state.provider } : {}),
    ...(state.model ? { model: state.model } : {}),
    ...(state.cwd ? { cwd: state.cwd } : {}),
    tokens,
    conversations: 1,
  };
}

async function readRolloutUsage(
  file: string,
  input: { start: number; end: number; state: RolloutState },
  records: HarnessNativeUsageRecord[],
): Promise<number> {
  const { state } = input;
  let consumed = input.start;
  for await (const { line, end } of completeLines(file, input.start, input.end)) {
    consumed = end;
    // Skip parsing the large message and tool lines that cannot change usage or its context.
    if (
      !line.includes('"token_count"') &&
      !line.includes('"turn_context"') &&
      !line.includes('"session_meta"')
    ) {
      continue;
    }
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry) || !isRecord(entry.payload)) continue;
    const { payload } = entry;
    if (entry.type === "session_meta") {
      const id = text(payload.id);
      // Only the first metadata is this rollout's own; a fork then replays its parent's.
      if (!state.sessionId) {
        state.sessionId = id;
        state.provider = text(payload.model_provider);
        state.cwd = text(payload.cwd);
      }
      state.historyId = id ?? state.historyId;
    } else if (entry.type === "turn_context") {
      state.model = text(payload.model) ?? state.model;
      state.cwd = text(payload.cwd) ?? state.cwd;
    } else if (
      entry.type === "event_msg" &&
      payload.type === "token_count" &&
      isRecord(payload.info)
    ) {
      const record = consumeTokenCount(state, entry.timestamp, payload.info);
      if (record) records.push(record);
    }
  }
  return consumed;
}

/** Reads usage appended to Codex rollouts under `sessions` and `archived_sessions` since `cursor`. */
export async function readCodexNativeUsage(
  codexHome: string,
  cursor: JsonValue | null,
): Promise<HarnessNativeUsageBatch> {
  const previous: CodexUsageCursor = codexUsageCursorSchema.safeParse(cursor).data ?? {
    formatVersion: 1,
    files: {},
  };
  const next: CodexUsageCursor = { formatVersion: 1, files: {} };
  const records: HarnessNativeUsageRecord[] = [];
  for (const relative of await rolloutFiles(codexHome)) {
    const file = path.join(codexHome, relative);
    try {
      const metadata = await stat(file, { bigint: true });
      if (!metadata.isFile()) continue;
      const ino = metadata.ino.toString();
      const size = Number(metadata.size);
      const known = previous.files[relative];
      // A moved, replaced or truncated rollout is read again; Host drops facts it already counted.
      const resume = known && known.ino === ino && known.offset <= size ? known : null;
      const state = resume ? structuredClone(resume.state) : emptyState();
      const offset = await readRolloutUsage(
        file,
        { start: resume?.offset ?? 0, end: size, state },
        records,
      );
      next.files[relative] = { ino, offset, state };
    } catch (error) {
      // Codex may archive or delete a rollout while it is being listed.
      if (!missing(error)) throw error;
    }
  }
  return { records, cursor: next };
}

/**
 * Official Codex has no Adapter, so the Codex runtime reads its native rollouts in the same shape
 * as {@link HarnessNativeUsageCapability} (ADR-0002).
 */
export function codexNativeUsage(codexHome: string): HarnessNativeUsageCapability {
  return Object.freeze({
    read: async (cursor: JsonValue | null) => {
      try {
        return { ok: true as const, value: await readCodexNativeUsage(codexHome, cursor) };
      } catch (error) {
        return {
          ok: false as const,
          error: {
            code: "unavailable" as const,
            message: "Codex usage records could not be read; check storage access and retry",
            retryable: true,
            diagnostic: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  });
}
