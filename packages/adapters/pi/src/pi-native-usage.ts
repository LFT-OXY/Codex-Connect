import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import path from "node:path";

import {
  emptyNativeSessionActivity,
  nativeSessionEdits,
  parseNativeSessionActivity,
  recordNativeSessionActivity,
  recordNativeSessionEdit,
  startNativeSessionTurn,
  type HarnessNativeSessionSummary,
  type HarnessNativeUsageBatch,
  type HarnessNativeUsageProgress,
  type HarnessNativeUsageRecord,
  type HarnessNativeUsageTokens,
  type NativeSessionActivity,
} from "@codexhost/harness-adapter";
import type { JsonValue } from "@codexhost/shared-contracts";

import { piSessionImportDirectory, piUserMessageTitle } from "./pi-session-import.js";

const NEWLINE = 0x0a;
/** Entries write their own timestamp before any nested field, so the first one is the entry's. */
const ENTRY_TIMESTAMP = /"timestamp":"([^"]+)"/u;
/** Pi's file-editing tools. */
const EDIT_TOOLS = new Set(["edit", "write"]);
/** Titles are for a list row; a first message used as one is shortened to a line. */
const TITLE_MAX_LENGTH = 120;

type PiSessionContext = {
  id: string;
  cwd?: string;
};

/** What a session file has said about its Session so far; never message text beyond its title. */
type PiFileSummary = {
  parentSessionId: string | null;
  /** The latest `session_info` name. */
  name: string | null;
  firstMessage: string | null;
  model: string | null;
  activity: NativeSessionActivity;
};

type PiUsageCursor = {
  // Version 1 had no Session summaries; such a cursor reads everything again.
  formatVersion: 2;
  /** Keyed by path relative to the sessions directory. */
  files: Record<
    string,
    {
      ino: string;
      offset: number;
      /** The file's header, needed to attribute lines after `offset`; null when not a session. */
      session: PiSessionContext | null;
      summary: PiFileSummary;
    }
  >;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function missing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sessionContext(value: unknown): PiSessionContext | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  if (value.cwd !== undefined && typeof value.cwd !== "string") return undefined;
  return value.cwd === undefined ? { id: value.id } : { id: value.id, cwd: value.cwd };
}

function emptySummary(): PiFileSummary {
  return {
    parentSessionId: null,
    name: null,
    firstMessage: null,
    model: null,
    activity: emptyNativeSessionActivity(),
  };
}

function nullableText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function fileSummary(value: unknown): PiFileSummary | undefined {
  if (!isRecord(value)) return undefined;
  const { parentSessionId, name, firstMessage, model } = value;
  const activity = parseNativeSessionActivity(value.activity);
  return nullableText(parentSessionId) &&
    nullableText(name) &&
    nullableText(firstMessage) &&
    nullableText(model) &&
    activity
    ? { parentSessionId, name, firstMessage, model, activity }
    : undefined;
}

/** A cursor that is not entirely valid reads everything again, like a missing one. */
function parseCursor(value: JsonValue | null): PiUsageCursor {
  const empty: PiUsageCursor = { formatVersion: 2, files: {} };
  if (!isRecord(value) || value.formatVersion !== 2 || !isRecord(value.files)) return empty;
  const files: PiUsageCursor["files"] = {};
  for (const [relative, file] of Object.entries(value.files)) {
    if (!isRecord(file)) return empty;
    const session = sessionContext(file.session);
    const summary = fileSummary(file.summary);
    const { ino, offset } = file;
    if (
      typeof ino !== "string" ||
      typeof offset !== "number" ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      session === undefined ||
      summary === undefined
    ) {
      return empty;
    }
    files[relative] = { ino, offset, session, summary };
  }
  return { formatVersion: 2, files };
}

/**
 * Every session file below the sessions directory, including subagent sessions that Pi extensions
 * keep inside a parent session's folder. Symlinks are not followed.
 */
async function sessionFiles(directory: string, signal: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    signal.throwIfAborted();
    const entries = await opendir(dir).catch((error: unknown) => {
      if (missing(error)) return null;
      throw error;
    });
    if (!entries) return;
    for await (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(child);
    }
  };
  await visit(directory);
  return files;
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

function usageTokens(usage: Record<string, unknown>): HarnessNativeUsageTokens {
  const output = count(usage.output);
  // Pi reports reasoning as a subset of output; split it out so it is not counted twice.
  const reasoning = Math.min(count(usage.reasoning), output);
  return {
    input: count(usage.input),
    cacheRead: count(usage.cacheRead),
    cacheWrite: count(usage.cacheWrite),
    output: output - reasoning,
    reasoning,
  };
}

/** Pi writes 0 both for free usage and for models without configured prices; only a positive cost is known. */
function reportedCost(usage: Record<string, unknown>): number | undefined {
  const total = isRecord(usage.cost) ? usage.cost.total : undefined;
  return typeof total === "number" && Number.isFinite(total) && total > 0 ? total : undefined;
}

/**
 * A subagent's header names its parent Session. A fork's names the parent's session file instead;
 * a fork is a Session of its own, resumed on its own, so it has no parent here.
 */
function parentSessionId(header: Record<string, unknown>): string | null {
  const parent = text(header.parentSession);
  return parent && !parent.endsWith(".jsonl") ? parent : null;
}

function shortTitle(value: string | null): string | null {
  const title = value?.replaceAll(/\s+/gu, " ").trim();
  if (!title) return null;
  const characters = [...title];
  return characters.length <= TITLE_MAX_LENGTH
    ? title
    : `${characters
        .slice(0, TITLE_MAX_LENGTH - 1)
        .join("")
        .trimEnd()}…`;
}

/** Adds one entry after the header to its file's Session summary. */
function summarize(summary: PiFileSummary, entry: Record<string, unknown>): void {
  if (entry.type === "session_info") {
    summary.name = typeof entry.name === "string" ? shortTitle(entry.name) : null;
    return;
  }
  const message = isRecord(entry.message) ? entry.message : null;
  if (entry.type !== "message" || !message) return;
  if (message.role === "user") {
    summary.firstMessage ??= shortTitle(piUserMessageTitle(message));
    startNativeSessionTurn(summary.activity);
  } else if (message.role === "assistant") {
    summary.model = text(message.model) ?? summary.model;
    if (
      Array.isArray(message.content) &&
      message.content.some(
        (block) =>
          isRecord(block) &&
          block.type === "toolCall" &&
          typeof block.name === "string" &&
          EDIT_TOOLS.has(block.name),
      )
    ) {
      recordNativeSessionEdit(summary.activity);
    }
  }
}

function sessionSummary(
  relative: string,
  session: PiSessionContext | null,
  summary: PiFileSummary,
): HarnessNativeSessionSummary | null {
  const { activity } = summary;
  if (!session || activity.firstActivityAt === null || activity.lastActivityAt === null) {
    return null;
  }
  const title = summary.name ?? summary.firstMessage;
  return {
    key: relative,
    nativeSessionId: session.id,
    ...(summary.parentSessionId ? { parentSessionId: summary.parentSessionId } : {}),
    ...(title ? { title } : {}),
    ...(session.cwd ? { cwd: session.cwd } : {}),
    ...(summary.model ? { model: summary.model } : {}),
    firstActivityAt: activity.firstActivityAt,
    lastActivityAt: activity.lastActivityAt,
    activeMs: activity.activeMs,
    turns: activity.turns,
    edits: nativeSessionEdits(activity),
  };
}

function sessionHeader(entry: Record<string, unknown>): PiSessionContext | null {
  const id = text(entry.id);
  if (entry.type !== "session" || !id) return null;
  const cwd = text(entry.cwd);
  return { id, ...(cwd ? { cwd } : {}) };
}

function assistantRecord(
  entry: Record<string, unknown>,
  session: PiSessionContext,
): HarnessNativeUsageRecord | null {
  const message = isRecord(entry.message) ? entry.message : null;
  if (entry.type !== "message" || message?.role !== "assistant" || !isRecord(message.usage)) {
    return null;
  }
  const entryId = text(entry.id);
  const timestamp = text(entry.timestamp);
  const time = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
  if (!entryId || !timestamp || !Number.isFinite(time)) return null;
  const tokens = usageTokens(message.usage);
  const hasTokens = Object.values(tokens).some((value) => value > 0);
  const provider = text(message.provider);
  const model = text(message.model);
  const cost = reportedCost(message.usage);
  return {
    // Forks copy entries with their id and timestamp; the pair also avoids short-id collisions.
    dedupeKey: `message:${entryId}:${timestamp}`,
    occurredAt: time,
    nativeSessionId: session.id,
    ...(provider ? { provider } : {}),
    // A reply without tokens (for example a failed request) only counts as a conversation.
    ...(model && hasTokens ? { model } : {}),
    ...(session.cwd ? { cwd: session.cwd } : {}),
    tokens,
    conversations: 1,
    ...(cost !== undefined && hasTokens ? { reportedCostUsd: cost } : {}),
  };
}

async function readFileUsage(
  file: string,
  input: { start: number; end: number; session: PiSessionContext | null; summary: PiFileSummary },
  records: HarnessNativeUsageRecord[],
): Promise<{ offset: number; session: PiSessionContext | null }> {
  const { summary } = input;
  let { session } = input;
  let offset = input.start;
  for await (const { line, end } of completeLines(file, input.start, input.end)) {
    const first = offset === 0;
    offset = end;
    const timestamp = ENTRY_TIMESTAMP.exec(line)?.[1];
    const time = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
    if ((first || session) && Number.isFinite(time)) {
      recordNativeSessionActivity(summary.activity, time);
    }
    // Skip parsing tool results and other large lines that cannot carry usage or a summary.
    if (
      !first &&
      !line.includes('"usage"') &&
      !line.includes('"role":"user"') &&
      !line.includes('"session_info"')
    ) {
      continue;
    }
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry)) continue;
    if (first) {
      session = sessionHeader(entry);
      summary.parentSessionId = session ? parentSessionId(entry) : null;
      continue;
    }
    if (!session) continue;
    summarize(summary, entry);
    const record = assistantRecord(entry, session);
    if (record) records.push(record);
  }
  return { offset, session };
}

/** Reads usage appended to Pi's native session files since `cursor`. */
export async function readPiNativeUsage(
  environment: NodeJS.ProcessEnv,
  cursor: JsonValue | null,
  signal: AbortSignal,
  onProgress?: (progress: HarnessNativeUsageProgress) => void,
): Promise<HarnessNativeUsageBatch> {
  const { directory } = piSessionImportDirectory(environment);
  const previous = parseCursor(cursor);
  const next: PiUsageCursor = { formatVersion: 2, files: {} };
  const records: HarnessNativeUsageRecord[] = [];
  const sessions: HarnessNativeSessionSummary[] = [];
  const files = await sessionFiles(directory, signal);
  onProgress?.({ processed: 0, total: files.length });
  for (const [index, file] of files.entries()) {
    signal.throwIfAborted();
    const relative = path.relative(directory, file);
    try {
      const metadata = await stat(file, { bigint: true });
      const ino = metadata.ino.toString();
      const size = Number(metadata.size);
      const known = previous.files[relative];
      // A replaced or truncated file is read again; Host drops facts it already counted.
      const resume = known && known.ino === ino && known.offset <= size ? known : null;
      const summary = resume ? structuredClone(resume.summary) : emptySummary();
      const { offset, session } = await readFileUsage(
        file,
        { start: resume?.offset ?? 0, end: size, session: resume?.session ?? null, summary },
        records,
      );
      next.files[relative] = { ino, offset, session, summary };
      if (!resume || offset > resume.offset) {
        const changed = sessionSummary(relative, session, summary);
        if (changed) sessions.push(changed);
      }
    } catch (error) {
      // Pi may delete a session file while it is being listed.
      if (!missing(error)) throw error;
    }
    onProgress?.({ processed: index + 1, total: files.length });
  }
  return { records, sessions, cursor: next };
}
