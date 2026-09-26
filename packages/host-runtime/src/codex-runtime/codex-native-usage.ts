import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  emptyNativeSessionActivity,
  isFileEditTool,
  nativeSessionEdits,
  parseNativeSessionActivity,
  recordNativeSessionActivity,
  recordNativeSessionEdit,
  startNativeSessionTurn,
  type HarnessNativeSessionSummary,
  type HarnessNativeUsageBatch,
  type HarnessNativeUsageProgress,
  type HarnessNativeUsageCapability,
  type HarnessNativeUsageRecord,
  type NativeSessionActivity,
} from "@codexhost/harness-adapter";
import type { JsonValue } from "@codexhost/shared-contracts";
import { z } from "zod";

const NEWLINE = 0x0a;
const ROLLOUT_DIRECTORIES = ["sessions", "archived_sessions"] as const;
const ROLLOUT_NAME = /^rollout-.*\.jsonl$/u;
/** Codex keeps the names of its threads here, one `{ id, thread_name }` line per rename. */
const SESSION_INDEX = "session_index.jsonl";
const TITLE_MAX_LENGTH = 120;
/** Every rollout line starts with its timestamp, so activity is read without parsing the line. */
const LINE_TIMESTAMP = /^\{"timestamp":"([^"]+)"/u;
/** Edits made through the code-mode `exec` tool name the editing tool in its script. */
const EXEC_TOOL_CALL = /\btools\.([A-Za-z_]+)\s*\(/gu;
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
  /** The Session this rollout forked from or was spawned by. */
  parentSessionId: z.string().nullable(),
  activity: z.custom<NativeSessionActivity>((value) => parseNativeSessionActivity(value) !== null),
  /** Turns are counted from turn contexts once the rollout has any; before that, from prompts. */
  turnContexts: z.boolean(),
  turnId: z.string().nullable(),
});

type RolloutState = z.infer<typeof rolloutStateSchema>;

const codexUsageCursorSchema = z.strictObject({
  // Version 1 had no Session summaries; such a cursor reads everything again.
  formatVersion: z.literal(2),
  /** Read position in the session index, and the thread names read from it so far. */
  index: z.strictObject({ ino: z.string(), offset: countSchema }).nullable(),
  titles: z.record(z.string(), z.string()),
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
  return {
    sessionId: null,
    historyId: null,
    provider: null,
    model: null,
    cwd: null,
    total: null,
    parentSessionId: null,
    activity: emptyNativeSessionActivity(),
    turnContexts: false,
    turnId: null,
  };
}

function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replaceAll(/\s+/gu, " ").trim();
  if (!title) return null;
  const characters = [...title];
  return characters.length <= TITLE_MAX_LENGTH
    ? title
    : `${characters
        .slice(0, TITLE_MAX_LENGTH - 1)
        .join("")
        .trimEnd()}…`;
}

/** A forked rollout names its source; a spawned subagent names the thread that spawned it. */
function parentSessionId(meta: Record<string, unknown>): string | null {
  const { source } = meta;
  const spawn =
    isRecord(source) && isRecord(source.subagent) && isRecord(source.subagent.thread_spawn)
      ? text(source.subagent.thread_spawn.parent_thread_id)
      : null;
  return text(meta.forked_from_id) ?? text(meta.parent_thread_id) ?? spawn;
}

/** Tool names a function or custom tool call uses, including those in a code-mode script. */
function calledTools(payload: Record<string, unknown>): string[] {
  if (payload.type !== "function_call" && payload.type !== "custom_tool_call") return [];
  const name = text(payload.name)?.replace(/^functions[.:/]/u, "");
  if (!name) return [];
  if (name !== "exec") return [name];
  return typeof payload.input === "string"
    ? [...payload.input.matchAll(EXEC_TOOL_CALL)].flatMap((match) => (match[1] ? [match[1]] : []))
    : [];
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
    const timestamp = LINE_TIMESTAMP.exec(line)?.[1];
    const time = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
    if (Number.isFinite(time)) recordNativeSessionActivity(state.activity, time);
    // Skip parsing the large message and tool lines that cannot change usage, its context, or the
    // Session's turns and edits.
    if (
      !line.includes('"token_count"') &&
      !line.includes('"turn_context"') &&
      !line.includes('"session_meta"') &&
      !line.includes('"user_message"') &&
      !line.includes('"function_call"') &&
      !line.includes('"custom_tool_call"')
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
        state.parentSessionId = parentSessionId(payload);
      }
      state.historyId = id ?? state.historyId;
    } else if (entry.type === "turn_context") {
      state.model = text(payload.model) ?? state.model;
      state.cwd = text(payload.cwd) ?? state.cwd;
      const turnId = text(payload.turn_id);
      // Codex can repeat a turn's context within the turn.
      if (turnId === null || turnId !== state.turnId) startNativeSessionTurn(state.activity);
      state.turnContexts = true;
      state.turnId = turnId;
    } else if (entry.type === "event_msg" && payload.type === "user_message") {
      // Rollouts written before turn contexts existed count each prompt as a turn.
      if (!state.turnContexts) startNativeSessionTurn(state.activity);
    } else if (entry.type === "response_item") {
      if (calledTools(payload).some(isFileEditTool)) recordNativeSessionEdit(state.activity);
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

function sessionSummary(
  state: RolloutState,
  titles: Readonly<Record<string, string>>,
): HarnessNativeSessionSummary | null {
  const { sessionId, activity } = state;
  if (!sessionId || activity.firstActivityAt === null || activity.lastActivityAt === null) {
    return null;
  }
  const title = titles[sessionId];
  return {
    // Keyed by Session rather than file, so an archived rollout replaces its earlier summary.
    key: sessionId,
    nativeSessionId: sessionId,
    ...(state.parentSessionId ? { parentSessionId: state.parentSessionId } : {}),
    ...(title ? { title } : {}),
    ...(state.cwd ? { cwd: state.cwd } : {}),
    ...(state.model ? { model: state.model } : {}),
    firstActivityAt: activity.firstActivityAt,
    lastActivityAt: activity.lastActivityAt,
    activeMs: activity.activeMs,
    turns: activity.turns,
    edits: nativeSessionEdits(activity),
  };
}

/** Reads thread names added to the session index since `previous`; returns the renamed IDs. */
async function readSessionIndex(
  codexHome: string,
  previous: CodexUsageCursor,
  next: CodexUsageCursor,
): Promise<Set<string>> {
  const file = path.join(codexHome, SESSION_INDEX);
  const renamed = new Set<string>();
  let metadata;
  try {
    metadata = await stat(file, { bigint: true });
  } catch (error) {
    if (missing(error)) return renamed;
    throw error;
  }
  const ino = metadata.ino.toString();
  const size = Number(metadata.size);
  const continued =
    previous.index && previous.index.ino === ino && previous.index.offset <= size
      ? previous.index
      : null;
  if (continued) next.titles = { ...previous.titles };
  let offset = continued?.offset ?? 0;
  for await (const { line, end } of completeLines(file, offset, size)) {
    offset = end;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry)) continue;
    const id = text(entry.id);
    const title = cleanTitle(entry.thread_name);
    if (!id || !title || next.titles[id] === title) continue;
    next.titles[id] = title;
    renamed.add(id);
  }
  next.index = { ino, offset };
  if (!continued) {
    // A rewritten index may have dropped names; every Session is summarized again.
    for (const id of Object.keys(previous.titles)) renamed.add(id);
  }
  return renamed;
}

/** Reads usage appended to Codex rollouts under `sessions` and `archived_sessions` since `cursor`. */
export async function readCodexNativeUsage(
  codexHome: string,
  cursor: JsonValue | null,
  onProgress?: (progress: HarnessNativeUsageProgress) => void,
): Promise<HarnessNativeUsageBatch> {
  const previous: CodexUsageCursor = codexUsageCursorSchema.safeParse(cursor).data ?? {
    formatVersion: 2,
    index: null,
    titles: {},
    files: {},
  };
  const next: CodexUsageCursor = { formatVersion: 2, index: null, titles: {}, files: {} };
  const records: HarnessNativeUsageRecord[] = [];
  const sessions: HarnessNativeSessionSummary[] = [];
  const renamed = await readSessionIndex(codexHome, previous, next);
  const files = await rolloutFiles(codexHome);
  onProgress?.({ processed: 0, total: files.length });
  for (const [index, relative] of files.entries()) {
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
      if (
        !resume ||
        offset > resume.offset ||
        (state.sessionId !== null && renamed.has(state.sessionId))
      ) {
        const session = sessionSummary(state, next.titles);
        if (session) sessions.push(session);
      }
    } catch (error) {
      // Codex may archive or delete a rollout while it is being listed.
      if (!missing(error)) throw error;
    }
    onProgress?.({ processed: index + 1, total: files.length });
  }
  return { records, sessions, cursor: next };
}

/**
 * Official Codex has no Adapter, so the Codex runtime reads its native rollouts in the same shape
 * as {@link HarnessNativeUsageCapability} (ADR-0002).
 */
export function codexNativeUsage(codexHome: string): HarnessNativeUsageCapability {
  return Object.freeze({
    read: async (
      cursor: JsonValue | null,
      onProgress?: (progress: HarnessNativeUsageProgress) => void,
    ) => {
      try {
        return {
          ok: true as const,
          value: await readCodexNativeUsage(codexHome, cursor, onProgress),
        };
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
