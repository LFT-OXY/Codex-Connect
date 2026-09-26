import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  HarnessNativeUsageBatch,
  HarnessNativeUsageProgress,
  HarnessNativeUsageRecord,
  HarnessNativeUsageTokens,
} from "@codexhost/harness-adapter";
import type { JsonValue } from "@codexhost/shared-contracts";

const NEWLINE = 0x0a;

type OmpSessionContext = {
  id: string;
  cwd?: string;
};

type OmpUsageCursor = {
  formatVersion: 1;
  /** Keyed by path relative to the sessions directory. */
  files: Record<
    string,
    {
      ino: string;
      offset: number;
      /** The file's header, needed to attribute lines after `offset`; null when not a session. */
      session: OmpSessionContext | null;
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

async function isDirectory(directory: string): Promise<boolean> {
  return stat(directory).then(
    (metadata) => metadata.isDirectory(),
    () => false,
  );
}

/**
 * Mirrors OMP's session directory resolution without profiles: `PI_CODING_AGENT_SESSION_DIR`,
 * then `PI_CODING_AGENT_DIR/sessions`, then the default agent directory under `~/.omp` (or
 * `PI_CONFIG_DIR`), whose data moves to `$XDG_DATA_HOME/omp` when that directory exists.
 */
async function ompSessionsDirectory(environment: NodeJS.ProcessEnv): Promise<string> {
  const custom = environment.PI_CODING_AGENT_SESSION_DIR;
  if (custom) return path.resolve(custom);
  const home =
    (process.platform === "win32" ? environment.USERPROFILE : environment.HOME) || os.homedir();
  const defaultAgent = path.join(home, environment.PI_CONFIG_DIR || ".omp", "agent");
  const agent = environment.PI_CODING_AGENT_DIR
    ? path.resolve(environment.PI_CODING_AGENT_DIR)
    : defaultAgent;
  if (agent === defaultAgent && environment.XDG_DATA_HOME) {
    const data = path.join(environment.XDG_DATA_HOME, "omp");
    if (await isDirectory(data)) return path.join(data, "sessions");
  }
  return path.join(agent, "sessions");
}

function sessionContext(value: unknown): OmpSessionContext | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  if (value.cwd !== undefined && typeof value.cwd !== "string") return undefined;
  return value.cwd === undefined ? { id: value.id } : { id: value.id, cwd: value.cwd };
}

/** A cursor that is not entirely valid reads everything again, like a missing one. */
function parseCursor(value: JsonValue | null): OmpUsageCursor {
  const empty: OmpUsageCursor = { formatVersion: 1, files: {} };
  if (!isRecord(value) || value.formatVersion !== 1 || !isRecord(value.files)) return empty;
  const files: OmpUsageCursor["files"] = {};
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
  input: { start: number; end: number; session: OmpSessionContext | null },
  records: HarnessNativeUsageRecord[],
): Promise<{ offset: number; session: OmpSessionContext | null }> {
  // At the start of a file the header is still unknown; OMP puts a fixed-width title slot before it.
  let session: OmpSessionContext | null | "pending" = input.start === 0 ? "pending" : input.session;
  let offset = input.start;
  for await (const { line, end } of completeLines(file, input.start, input.end)) {
    offset = end;
    // Skip parsing tool results and other large lines that cannot carry usage.
    if (session !== "pending" && !line.includes('"usage"')) continue;
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
      continue;
    }
    if (!session || !isRecord(entry)) continue;
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
  const next: OmpUsageCursor = { formatVersion: 1, files: {} };
  const records: HarnessNativeUsageRecord[] = [];
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
      const { offset, session } = await readFileUsage(
        file,
        { start: resume?.offset ?? 0, end: size, session: resume?.session ?? null },
        records,
      );
      next.files[relative] = { ino, offset, session };
    } catch (error) {
      // OMP may delete a session file while it is being listed.
      if (!missing(error)) throw error;
    }
    onProgress?.({ processed: index + 1, total: files.length });
  }
  return { records, cursor: next };
}
