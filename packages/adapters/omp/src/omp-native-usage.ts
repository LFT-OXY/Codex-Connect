import { createReadStream } from "node:fs";
import { open, opendir, stat } from "node:fs/promises";
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

import { ompSessionsDirectory, ompUserMessageTitle } from "./omp-session-import.js";

const NEWLINE = 0x0a;
/** Entries write their own timestamp before any nested field, so the first one is the entry's. */
const ENTRY_TIMESTAMP = /"timestamp":"([^"]+)"/u;
/** OMP pads its title slot to a fixed width; it is well below this. */
const TITLE_SLOT_MAX_BYTES = 64 * 1024;
/** Titles are for a list row; a first message used as one is shortened to a line. */
const TITLE_MAX_LENGTH = 120;
/** OMP's file-editing tools. */
const EDIT_TOOLS = new Set(["edit", "write"]);

type OmpSessionContext = {
  id: string;
  cwd?: string;
};

/** What a session file has said about its Session so far; never message text beyond its title. */
type OmpFileSummary = {
  /** The title slot, rewritten in place by OMP, then the header's title. */
  title: string | null;
  firstMessage: string | null;
  model: string | null;
  activity: NativeSessionActivity;
};

type OmpUsageCursor = {
  // Version 1 had no Session summaries; such a cursor reads everything again.
  formatVersion: 2;
  /** Keyed by path relative to the sessions directory. */
  files: Record<
    string,
    {
      ino: string;
      /** Modification time; OMP rewrites the title slot in place without appending. */
      mtimeMs: number;
      offset: number;
      /** The file's header, needed to attribute lines after `offset`; null when not a session. */
      session: OmpSessionContext | null;
      summary: OmpFileSummary;
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

function sessionContext(value: unknown): OmpSessionContext | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  if (value.cwd !== undefined && typeof value.cwd !== "string") return undefined;
  return value.cwd === undefined ? { id: value.id } : { id: value.id, cwd: value.cwd };
}

function emptySummary(): OmpFileSummary {
  return {
    title: null,
    firstMessage: null,
    model: null,
    activity: emptyNativeSessionActivity(),
  };
}

function nullableText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function fileSummary(value: unknown): OmpFileSummary | undefined {
  if (!isRecord(value)) return undefined;
  const { title, firstMessage, model } = value;
  const activity = parseNativeSessionActivity(value.activity);
  return nullableText(title) && nullableText(firstMessage) && nullableText(model) && activity
    ? { title, firstMessage, model, activity }
    : undefined;
}

/** A cursor that is not entirely valid reads everything again, like a missing one. */
function parseCursor(value: JsonValue | null): OmpUsageCursor {
  const empty: OmpUsageCursor = { formatVersion: 2, files: {} };
  if (!isRecord(value) || value.formatVersion !== 2 || !isRecord(value.files)) return empty;
  const files: OmpUsageCursor["files"] = {};
  for (const [relative, file] of Object.entries(value.files)) {
    if (!isRecord(file)) return empty;
    const session = sessionContext(file.session);
    const summary = fileSummary(file.summary);
    const { ino, mtimeMs, offset } = file;
    if (
      typeof ino !== "string" ||
      typeof mtimeMs !== "number" ||
      !Number.isFinite(mtimeMs) ||
      typeof offset !== "number" ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      session === undefined ||
      summary === undefined
    ) {
      return empty;
    }
    files[relative] = { ino, mtimeMs, offset, session, summary };
  }
  return { formatVersion: 2, files };
}

/**
 * Every session file below the sessions directory, including the subagent sessions OMP keeps in a
 * folder named after the parent session file. Symlinks are not followed.
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
  // OMP's reasoningTokens are part of output (totalTokens omits them); split them out once.
  const reasoning = Math.min(count(usage.reasoningTokens), output);
  return {
    input: count(usage.input),
    cacheRead: count(usage.cacheRead),
    cacheWrite: count(usage.cacheWrite),
    output: output - reasoning,
    reasoning,
  };
}

/** OMP writes 0 both for free usage and for models without configured prices; only a positive cost is known. */
function reportedCost(usage: Record<string, unknown>): number | undefined {
  const total = isRecord(usage.cost) ? usage.cost.total : undefined;
  return typeof total === "number" && Number.isFinite(total) && total > 0 ? total : undefined;
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

/** The title OMP keeps in its slot before the header, or null. */
async function readTitleSlot(file: string): Promise<string | null> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(TITLE_SLOT_MAX_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, bytesRead).indexOf(NEWLINE);
    if (newline === -1) return null;
    const slot: unknown = JSON.parse(buffer.toString("utf8", 0, newline));
    return isRecord(slot) && slot.type === "title" && typeof slot.title === "string"
      ? shortTitle(slot.title)
      : null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/** Adds one entry after the header to its file's Session summary. */
function summarize(summary: OmpFileSummary, entry: Record<string, unknown>): void {
  const message = isRecord(entry.message) ? entry.message : null;
  if (entry.type !== "message" || !message) return;
  if (message.role === "user") {
    summary.firstMessage ??= shortTitle(ompUserMessageTitle(message));
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

/**
 * A subagent's session file sits in a folder named after its parent's file, possibly nested, so
 * its parent is the Session of that file. A fork is a Session of its own and has no parent here.
 */
function sessionSummary(
  relative: string,
  file: OmpUsageCursor["files"][string],
  files: OmpUsageCursor["files"],
): HarnessNativeSessionSummary | null {
  const { session, summary } = file;
  const { activity } = summary;
  if (!session || activity.firstActivityAt === null || activity.lastActivityAt === null) {
    return null;
  }
  const parentFile = files[`${path.dirname(relative)}.jsonl`];
  const parentSessionId = parentFile?.session?.id;
  const title = summary.title ?? summary.firstMessage;
  return {
    key: relative,
    nativeSessionId: session.id,
    ...(parentSessionId ? { parentSessionId } : {}),
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

function sessionHeader(entry: Record<string, unknown>): OmpSessionContext | null {
  const id = text(entry.id);
  if (!id) return null;
  const cwd = text(entry.cwd);
  return { id, ...(cwd ? { cwd } : {}) };
}

function assistantRecord(
  entry: Record<string, unknown>,
  session: OmpSessionContext,
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
  input: {
    start: number;
    end: number;
    session: OmpSessionContext | null;
    summary: OmpFileSummary;
  },
  records: HarnessNativeUsageRecord[],
): Promise<{ offset: number; session: OmpSessionContext | null }> {
  const { summary } = input;
  // At the start of a file the header is still unknown; OMP puts a fixed-width title slot before it.
  let session: OmpSessionContext | null | "pending" = input.start === 0 ? "pending" : input.session;
  let offset = input.start;
  for await (const { line, end } of completeLines(file, input.start, input.end)) {
    offset = end;
    if (session !== "pending" && session !== null) {
      const timestamp = ENTRY_TIMESTAMP.exec(line)?.[1];
      const time = timestamp === undefined ? Number.NaN : Date.parse(timestamp);
      if (Number.isFinite(time)) recordNativeSessionActivity(summary.activity, time);
    }
    // Skip parsing tool results and other large lines that cannot carry usage or a turn.
    if (session !== "pending" && !line.includes('"usage"') && !line.includes('"role":"user"')) {
      continue;
    }
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      if (session === "pending") session = null;
      continue;
    }
    if (session === "pending") {
      if (isRecord(entry) && entry.type === "title") continue;
      session = isRecord(entry) && entry.type === "session" ? sessionHeader(entry) : null;
      if (session && isRecord(entry)) {
        summary.title ??= shortTitle(text(entry.title) ?? null);
        const time = Date.parse(String(entry.timestamp));
        if (Number.isFinite(time)) recordNativeSessionActivity(summary.activity, time);
      }
      continue;
    }
    if (!session || !isRecord(entry)) continue;
    summarize(summary, entry);
    const record = assistantRecord(entry, session);
    if (record) records.push(record);
  }
  // Without a complete header yet, read the file from its start next time.
  return session === "pending" ? { offset: 0, session: null } : { offset, session };
}

/** Reads usage appended to OMP's native session files since `cursor`. */
export async function readOmpNativeUsage(
  environment: NodeJS.ProcessEnv,
  cursor: JsonValue | null,
  signal: AbortSignal,
  onProgress?: (progress: HarnessNativeUsageProgress) => void,
): Promise<HarnessNativeUsageBatch> {
  const directory = await ompSessionsDirectory(environment);
  const previous = parseCursor(cursor);
  const next: OmpUsageCursor = { formatVersion: 2, files: {} };
  const records: HarnessNativeUsageRecord[] = [];
  const changed: string[] = [];
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
      const mtimeMs = Number(metadata.mtimeMs);
      // A replaced or truncated file is read again; Host drops facts it already counted.
      const resume = known && known.ino === ino && known.offset <= size ? known : null;
      const summary = resume ? structuredClone(resume.summary) : emptySummary();
      const { offset, session } = await readFileUsage(
        file,
        { start: resume?.offset ?? 0, end: size, session: resume?.session ?? null, summary },
        records,
      );
      const modified = !resume || offset > resume.offset || mtimeMs !== resume.mtimeMs;
      if (modified && session) {
        summary.title = (await readTitleSlot(file)) ?? summary.title;
        changed.push(relative);
      }
      next.files[relative] = { ino, mtimeMs, offset, session, summary };
    } catch (error) {
      // OMP may delete a session file while it is being listed.
      if (!missing(error)) throw error;
    }
    onProgress?.({ processed: index + 1, total: files.length });
  }
  // Summarized once every file is read, so a subagent finds its parent's Session.
  const sessions = changed.flatMap((relative) => {
    const file = next.files[relative];
    const summary = file ? sessionSummary(relative, file, next.files) : null;
    return summary ? [summary] : [];
  });
  return { records, sessions, cursor: next };
}
