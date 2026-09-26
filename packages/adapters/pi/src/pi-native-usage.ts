import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import path from "node:path";

import type {
  HarnessNativeUsageBatch,
  HarnessNativeUsageRecord,
  HarnessNativeUsageTokens,
} from "@codexhost/harness-adapter";
import type { JsonValue } from "@codexhost/shared-contracts";

import { piSessionImportDirectory } from "./pi-session-import.js";

const NEWLINE = 0x0a;

type PiSessionContext = {
  id: string;
  cwd?: string;
};

type PiUsageCursor = {
  formatVersion: 1;
  /** Keyed by path relative to the sessions directory. */
  files: Record<
    string,
    {
      ino: string;
      offset: number;
      /** The file's header, needed to attribute lines after `offset`; null when not a session. */
      session: PiSessionContext | null;
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

/** A cursor that is not entirely valid reads everything again, like a missing one. */
function parseCursor(value: JsonValue | null): PiUsageCursor {
  const empty: PiUsageCursor = { formatVersion: 1, files: {} };
  if (!isRecord(value) || value.formatVersion !== 1 || !isRecord(value.files)) return empty;
  const files: PiUsageCursor["files"] = {};
  for (const [relative, file] of Object.entries(value.files)) {
    if (!isRecord(file)) return empty;
    const session = sessionContext(file.session);
    const { ino, offset } = file;
    if (
      typeof ino !== "string" ||
      typeof offset !== "number" ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      session === undefined
    ) {
      return empty;
    }
    files[relative] = { ino, offset, session };
  }
  return { formatVersion: 1, files };
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
  input: { start: number; end: number; session: PiSessionContext | null },
  records: HarnessNativeUsageRecord[],
): Promise<{ offset: number; session: PiSessionContext | null }> {
  let { session } = input;
  let offset = input.start;
  for await (const { line, end } of completeLines(file, input.start, input.end)) {
    const first = offset === 0;
    offset = end;
    // Skip parsing tool results and other large lines that cannot carry usage.
    if (!first && !line.includes('"usage"')) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry)) continue;
    if (first) {
      session = sessionHeader(entry);
      continue;
    }
    if (!session) continue;
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
): Promise<HarnessNativeUsageBatch> {
  const { directory } = piSessionImportDirectory(environment);
  const previous = parseCursor(cursor);
  const next: PiUsageCursor = { formatVersion: 1, files: {} };
  const records: HarnessNativeUsageRecord[] = [];
  for (const file of await sessionFiles(directory, signal)) {
    signal.throwIfAborted();
    const relative = path.relative(directory, file);
    try {
      const metadata = await stat(file, { bigint: true });
      const ino = metadata.ino.toString();
      const size = Number(metadata.size);
      const known = previous.files[relative];
      // A replaced or truncated file is read again; Host drops facts it already counted.
      const resume = known && known.ino === ino && known.offset <= size ? known : null;
      const { offset, session } = await readFileUsage(
        file,
        { start: resume?.offset ?? 0, end: size, session: resume?.session ?? null },
        records,
      );
      next.files[relative] = { ino, offset, session };
    } catch (error) {
      // Pi may delete a session file while it is being listed.
      if (!missing(error)) throw error;
    }
  }
  return { records, cursor: next };
}
