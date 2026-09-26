import { createReadStream, type Stats } from "node:fs";
import { opendir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import type { HarnessSessionImportSource } from "@codexhost/harness-adapter";
import {
  HARNESS_SESSION_IMPORT_TITLE_MAX_LENGTH,
  harnessSessionImportCandidateSchema,
  nativeSessionRefSchema,
} from "@codexhost/shared-contracts";

// OMP's v3 JSONL session files, read like Pi's. Discovery never opens an Agent.
class OmpSessionChangedError extends Error {
  constructor() {
    super("Omp Session changed during discovery; refresh and retry");
  }
}

function sameFile(left: Stats, right: Stats): boolean {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs &&
    left.ino === right.ino &&
    left.dev === right.dev
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function missing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
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
export async function ompSessionsDirectory(environment: NodeJS.ProcessEnv): Promise<string> {
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

function title(value: unknown): string | null {
  return typeof value === "string"
    ? value.replaceAll("\0", "").trim().slice(0, HARNESS_SESSION_IMPORT_TITLE_MAX_LENGTH) || null
    : null;
}

/**
 * A prompt the user sent as a custom message, such as invoking a skill: OMP attributes it to the
 * user and shows it, unlike the context it injects.
 */
export function ompUserCustomMessage(entry: Record<string, unknown>): boolean {
  return entry.type === "custom_message" && entry.attribution === "user" && entry.display === true;
}

/** A user message's text as a Session title, for Sessions OMP has not named. */
export function ompUserMessageTitle(message: Record<string, unknown>): string | null {
  const content = message.content;
  return title(
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter(
              (block) => isRecord(block) && block.type === "text" && typeof block.text === "string",
            )
            .map((block) => block.text)
            .join(" ")
        : "",
  );
}

/**
 * Main session files: in the sessions directory and one level below it, where OMP groups them by
 * project. A folder named after a session file holds that session's subagents and is skipped.
 * Symlinks are not followed.
 */
async function sessionFiles(directory: string, signal: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  const visit = async (dir: string, projectLevel: boolean): Promise<void> => {
    signal.throwIfAborted();
    const entries = await opendir(dir).catch((error: unknown) => {
      if (missing(error)) return null;
      throw error;
    });
    if (!entries) return;
    const names = new Set<string>();
    const folders: string[] = [];
    for await (const entry of entries) {
      signal.throwIfAborted();
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        names.add(entry.name);
        files.push(path.join(dir, entry.name));
      } else if (projectLevel && entry.isDirectory()) {
        folders.push(entry.name);
      }
    }
    for (const folder of folders) {
      if (!names.has(`${folder}.jsonl`)) await visit(path.join(dir, folder), false);
    }
  };
  await visit(directory, true);
  return files;
}

async function readCandidate(
  file: string,
  signal: AbortSignal,
): Promise<HarnessSessionImportSource | null> {
  const before = await stat(file);
  if (!before.isFile() || before.size === 0) return null;
  const stream = createReadStream(file, { encoding: "utf8", signal, end: before.size - 1 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let header: Record<string, unknown> | undefined;
  let slotTitle: string | null = null;
  let firstMessage: string | null = null;
  let hasUser = false;
  let updatedAt = before.mtimeMs;
  // Only ancestry flags are retained, never message bodies or Transcript entries.
  const entries = new Map<string, boolean>();
  try {
    for await (const line of lines) {
      signal.throwIfAborted();
      if (!line.trim()) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(line);
      } catch {
        return null;
      }
      if (!isRecord(entry)) return null;
      if (!header) {
        // OMP reserves a fixed-width title slot before the header and rewrites it in place.
        if (entry.type === "title") {
          slotTitle = title(entry.title);
          continue;
        }
        if (
          entry.type !== "session" ||
          entry.version !== 3 ||
          typeof entry.id !== "string" ||
          typeof entry.cwd !== "string" ||
          !path.isAbsolute(entry.cwd)
        )
          return null;
        header = entry;
        continue;
      }
      if (
        typeof entry.id !== "string" ||
        entry.id.length === 0 ||
        entries.has(entry.id) ||
        (entry.parentId !== null &&
          (typeof entry.parentId !== "string" || !entries.has(entry.parentId)))
      )
        return null;
      const message = isRecord(entry.message) ? entry.message : null;
      if (!firstMessage && entry.type === "message" && message?.role === "user") {
        firstMessage = ompUserMessageTitle(message);
      }
      hasUser =
        (entry.type === "message" && message?.role === "user") ||
        ompUserCustomMessage(entry) ||
        (typeof entry.parentId === "string" && entries.get(entry.parentId) === true);
      entries.set(entry.id, hasUser);
      if (entry.type === "message" && (message?.role === "user" || message?.role === "assistant")) {
        const time =
          typeof message.timestamp === "number"
            ? message.timestamp
            : typeof entry.timestamp === "string"
              ? Date.parse(entry.timestamp)
              : NaN;
        if (Number.isFinite(time)) updatedAt = time;
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  if (!header) return null;
  if (!hasUser) return null;
  const after = await stat(file);
  if (!sameFile(before, after)) throw new OmpSessionChangedError();
  const cwd = await realpath(String(header.cwd));
  if (!(await stat(cwd)).isDirectory()) return null;
  const nativeRef = nativeSessionRefSchema.safeParse({
    harnessId: "omp",
    nativeSessionId: header.id,
    locator: { sessionFile: await realpath(file) },
    formatVersion: 1,
  });
  const candidate = harnessSessionImportCandidateSchema.safeParse({
    nativeSessionId: header.id,
    cwd,
    title: slotTitle ?? title(header.title) ?? firstMessage,
    updatedAt: Math.floor(updatedAt),
    // OMP has no reliable cross-process running marker.
    running: null,
  });
  return candidate.success && nativeRef.success
    ? { candidate: candidate.data, nativeRef: nativeRef.data }
    : null;
}

/** Read just the header, after the title slot, when checking a file's identity. */
async function readIdentity(file: string, signal: AbortSignal): Promise<string | null> {
  const stream = createReadStream(file, { encoding: "utf8", signal });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      signal.throwIfAborted();
      if (!line.trim()) continue;
      let header: unknown;
      try {
        header = JSON.parse(line);
      } catch {
        return null;
      }
      if (isRecord(header) && header.type === "title") continue;
      return isRecord(header) &&
        header.type === "session" &&
        header.version === 3 &&
        typeof header.id === "string"
        ? header.id
        : null;
    }
    return null;
  } finally {
    lines.close();
    stream.destroy();
  }
}

/** Per-Adapter metadata index. First discovery streams storage; later queries reuse unchanged files. */
export class OmpSessionImportIndex {
  readonly #environment: NodeJS.ProcessEnv;
  #cache = new Map<string, { fingerprint: Stats; source: HarnessSessionImportSource }>();
  #listing: Promise<HarnessSessionImportSource[]> | undefined;

  constructor(environment: NodeJS.ProcessEnv) {
    this.#environment = environment;
  }

  list(signal: AbortSignal): Promise<HarnessSessionImportSource[]> {
    this.#listing ??= this.#scan(signal).finally(() => {
      this.#listing = undefined;
    });
    return this.#listing;
  }

  async #scan(signal: AbortSignal): Promise<HarnessSessionImportSource[]> {
    const files = await sessionFiles(await ompSessionsDirectory(this.#environment), signal);
    const next = new Map<string, { fingerprint: Stats; source: HarnessSessionImportSource }>();
    const identities = new Set<string>();
    const sources: HarnessSessionImportSource[] = [];
    for (const file of files) {
      signal.throwIfAborted();
      try {
        const fingerprint = await stat(file);
        const cached = this.#cache.get(file);
        const source =
          cached && sameFile(cached.fingerprint, fingerprint)
            ? cached.source
            : await readCandidate(file, signal);
        if (!source) continue;
        // A deleted/recreated project must not be hidden forever by a cached file result.
        if (!(await stat(source.candidate.cwd)).isDirectory()) continue;
        if (identities.has(source.nativeRef.nativeSessionId))
          throw new Error("Omp Session identity is ambiguous across files");
        identities.add(source.nativeRef.nativeSessionId);
        next.set(file, { fingerprint, source });
        sources.push(source);
      } catch (error) {
        // An actively changing or deleted Session must not block every other Session's listing.
        if (!missing(error) && !(error instanceof OmpSessionChangedError)) throw error;
      }
    }
    this.#cache = next;
    return structuredClone(
      sources.sort((left, right) => right.candidate.updatedAt - left.candidate.updatedAt),
    );
  }

  async resolve(
    nativeSessionId: string,
    signal: AbortSignal,
  ): Promise<HarnessSessionImportSource | null> {
    let selected: string | undefined;
    for (const file of await sessionFiles(await ompSessionsDirectory(this.#environment), signal)) {
      signal.throwIfAborted();
      try {
        const fingerprint = await stat(file);
        const cached = this.#cache.get(file);
        const id =
          cached && sameFile(cached.fingerprint, fingerprint)
            ? cached.source.nativeRef.nativeSessionId
            : await readIdentity(file, signal);
        if (id !== nativeSessionId) continue;
        if (selected) throw new Error("Omp Session identity is ambiguous across files");
        selected = file;
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    if (!selected) return null;
    try {
      // No cached eligibility or browser locator is trusted at the commit boundary.
      const source = await readCandidate(selected, signal);
      return source?.nativeRef.nativeSessionId === nativeSessionId ? source : null;
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }
}
