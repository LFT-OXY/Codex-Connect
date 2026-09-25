import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import path from "node:path";

import type {
  HarnessNativeUsageBatch,
  HarnessNativeUsageRecord,
  HarnessNativeUsageTokens,
} from "@codexhost/harness-adapter";
import type { JsonValue } from "@codexhost/shared-contracts";
import { z } from "zod";

import { claudeProjectsDirectory } from "./claude-session-import.js";

const NEWLINE = 0x0a;
/**
 * A response without a stop reason may still stream: tools can run and write their results before
 * its final usage line. Wait for it while the transcript was written this recently.
 */
const STREAMING_WINDOW_MS = 60 * 60_000;

const claudeUsageCursorSchema = z.strictObject({
  formatVersion: z.literal(1),
  /** Keyed by path relative to the projects directory. */
  files: z.record(
    z.string(),
    z.strictObject({ ino: z.string(), offset: z.number().int().nonnegative().safe() }),
  ),
});

type ClaudeUsageCursor = z.infer<typeof claudeUsageCursorSchema>;

interface ClaudeUsageFile {
  relative: string;
  main: boolean;
}

interface ResponseUsage {
  record: HarnessNativeUsageRecord;
  firstLineStart: number;
  finished: boolean;
}

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

function occurredAt(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

async function directoryEntries(directory: string) {
  try {
    return await opendir(directory);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

/** Main transcripts sit one level below projects; subagent transcripts under `<session>/subagents`. */
async function usageFiles(projects: string): Promise<ClaudeUsageFile[]> {
  const files: ClaudeUsageFile[] = [];
  const projectEntries = await directoryEntries(projects);
  if (!projectEntries) return files;
  for await (const project of projectEntries) {
    if (!project.isDirectory()) continue;
    const entries = await directoryEntries(path.join(projects, project.name));
    if (!entries) continue;
    for await (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push({ relative: path.join(project.name, entry.name), main: true });
      } else if (entry.isDirectory()) {
        const subagents = path.join(project.name, entry.name, "subagents");
        const agentEntries = await directoryEntries(path.join(projects, subagents));
        if (!agentEntries) continue;
        for await (const agent of agentEntries) {
          if (agent.isFile() && agent.name.endsWith(".jsonl")) {
            files.push({ relative: path.join(subagents, agent.name), main: false });
          }
        }
      }
    }
  }
  return files;
}

/** Complete lines from `start`, with absolute byte offsets. A trailing partial line is left unread. */
async function* completeLines(
  file: string,
  start: number,
  end: number,
): AsyncGenerator<{ line: string; start: number; end: number }> {
  if (end <= start) return;
  let carry: Buffer = Buffer.alloc(0);
  let carryStart = start;
  for await (const chunk of createReadStream(file, { start, end: end - 1 })) {
    const buffer = carry.length > 0 ? Buffer.concat([carry, chunk as Buffer]) : (chunk as Buffer);
    let lineStart = 0;
    let newline = buffer.indexOf(NEWLINE, lineStart);
    while (newline !== -1) {
      yield {
        line: buffer.toString("utf8", lineStart, newline),
        start: carryStart + lineStart,
        end: carryStart + newline + 1,
      };
      lineStart = newline + 1;
      newline = buffer.indexOf(NEWLINE, lineStart);
    }
    carry = buffer.subarray(lineStart);
    carryStart += lineStart;
  }
}

function usageTokens(usage: Record<string, unknown>): HarnessNativeUsageTokens {
  return {
    input: count(usage.input_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
    cacheWrite: count(usage.cache_creation_input_tokens),
    output: count(usage.output_tokens),
    // Claude transcripts report thinking only as part of output_tokens.
    reasoning: 0,
  };
}

function zeroTokens(tokens: HarnessNativeUsageTokens): boolean {
  return (
    tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output + tokens.reasoning === 0
  );
}

/** A user-typed prompt in a main transcript; tool results are generated, not typed. */
function typedPrompt(entry: Record<string, unknown>): boolean {
  if (entry.type !== "user" || entry.isSidechain === true || !isRecord(entry.message)) return false;
  const { content } = entry.message;
  return (
    typeof content === "string" ||
    (Array.isArray(content) && content.some((block) => isRecord(block) && block.type === "text"))
  );
}

function baseRecord(
  entry: Record<string, unknown>,
  dedupeKey: string,
  time: number,
): HarnessNativeUsageRecord | null {
  const nativeSessionId = text(entry.sessionId);
  if (!nativeSessionId) return null;
  const cwd = text(entry.cwd);
  return {
    dedupeKey,
    occurredAt: time,
    nativeSessionId,
    ...(cwd ? { cwd } : {}),
    tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
    conversations: 0,
  };
}

async function readFileUsage(
  file: string,
  input: { main: boolean; start: number; end: number; mayStillStream: boolean },
  records: HarnessNativeUsageRecord[],
): Promise<number> {
  const { main, start, end } = input;
  const responses = new Map<string, ResponseUsage>();
  let consumed = start;
  for await (const { line, start: lineStart, end: lineEnd } of completeLines(file, start, end)) {
    consumed = lineEnd;
    // Skip parsing the large tool and attachment lines that cannot carry usage or a prompt.
    if (!line.includes('"usage"') && !line.includes('"type":"user"')) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry)) continue;
    const message = isRecord(entry.message) ? entry.message : null;
    if (entry.type === "user") {
      const uuid = text(entry.uuid);
      const time = occurredAt(entry.timestamp);
      if (!main || !uuid || time === null || !typedPrompt(entry)) continue;
      const record = baseRecord(entry, `prompt:${uuid}`, time);
      if (record) records.push({ ...record, conversations: 1 });
      continue;
    }
    if (entry.type !== "assistant" || !message || !isRecord(message.usage)) continue;
    const messageId = text(message.id);
    const time = occurredAt(entry.timestamp);
    if (!messageId || time === null) continue;
    const requestId = text(entry.requestId);
    const key = requestId ? `message:${messageId}:${requestId}` : `message:${messageId}`;
    const base = baseRecord(entry, key, time);
    if (!base) continue;
    const model = text(message.model);
    const record = { ...base, ...(model ? { model } : {}), tokens: usageTokens(message.usage) };
    // Repeated lines of one response carry the same or growing usage; the latest is final.
    const previous = responses.get(key);
    responses.set(key, {
      record,
      firstLineStart: previous?.firstLineStart ?? lineStart,
      finished: message.stop_reason !== null && message.stop_reason !== undefined,
    });
  }
  let resumeAt = consumed;
  for (const response of responses.values()) {
    // Read it again next time; Host drops the facts after it that it already counted.
    if (!response.finished && input.mayStillStream) {
      resumeAt = Math.min(resumeAt, response.firstLineStart);
      continue;
    }
    if (!zeroTokens(response.record.tokens)) records.push(response.record);
  }
  return resumeAt;
}

/** Reads usage appended to Claude Code's transcripts since `cursor`, including subagent files. */
export async function readClaudeNativeUsage(
  environment: NodeJS.ProcessEnv,
  cursor: JsonValue | null,
  signal: AbortSignal,
): Promise<HarnessNativeUsageBatch> {
  const projects = claudeProjectsDirectory(environment);
  const previous: ClaudeUsageCursor = claudeUsageCursorSchema.safeParse(cursor).data ?? {
    formatVersion: 1,
    files: {},
  };
  const next: ClaudeUsageCursor = { formatVersion: 1, files: {} };
  const records: HarnessNativeUsageRecord[] = [];
  for (const { relative, main } of await usageFiles(projects)) {
    signal.throwIfAborted();
    const file = path.join(projects, relative);
    try {
      const metadata = await stat(file, { bigint: true });
      const ino = metadata.ino.toString();
      const size = Number(metadata.size);
      const known = previous.files[relative];
      // A replaced or truncated file is read again; Host drops facts it already counted.
      const start = known && known.ino === ino && known.offset <= size ? known.offset : 0;
      const offset = await readFileUsage(
        file,
        {
          main,
          start,
          end: size,
          mayStillStream: Date.now() - Number(metadata.mtimeMs) < STREAMING_WINDOW_MS,
        },
        records,
      );
      next.files[relative] = { ino, offset };
    } catch (error) {
      // Native clients may delete a transcript while it is being listed.
      if (!missing(error)) throw error;
    }
  }
  return { records, cursor: next };
}
