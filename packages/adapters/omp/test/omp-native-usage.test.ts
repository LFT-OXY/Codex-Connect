import {
  appendFile,
  mkdtemp,
  mkdir,
  open,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  HarnessNativeUsageBatch,
  HarnessNativeUsageProgress,
} from "@codexhost/harness-adapter";
import type { JsonValue } from "@codexhost/shared-contracts";
import { afterEach, describe, expect, it } from "vitest";

import { OmpAdapter } from "../src/omp-adapter.js";

const roots: string[] = [];
const adapters: OmpAdapter[] = [];

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const SESSION = "019ff181-97a7-7000-961f-215614504164";
const FORK = "019ff181-97a7-7000-961f-215614504165";
const CHILD = "01a018b4-ce87-7000-90fa-5a69816b87aa";
const SECRET = "SYNTHETIC-PRIVATE-TEXT";
const SESSION_FILE = `2026-03-02T09-59-00-000Z_${SESSION}`;

async function temporaryRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "codexhost-omp-usage-")));
  roots.push(root);
  return root;
}

function reader(environment: NodeJS.ProcessEnv) {
  const adapter = new OmpAdapter({ environment });
  adapters.push(adapter);
  return async (
    cursor: JsonValue | null = null,
    onProgress?: (progress: HarnessNativeUsageProgress) => void,
  ): Promise<HarnessNativeUsageBatch> => {
    const result = await adapter.nativeUsage.read(cursor, onProgress);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
}

async function fixture() {
  const root = await temporaryRoot();
  const agent = path.join(root, "agent");
  const project = path.join(agent, "sessions", "-work-project");
  await mkdir(project, { recursive: true });
  const read = reader({ PI_CODING_AGENT_DIR: agent });
  return { agent, project, file: path.join(project, `${SESSION_FILE}.jsonl`), read };
}

function lines(...entries: unknown[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

// OMP rewrites this fixed-width slot in place when the title changes.
const TITLE = {
  type: "title",
  v: 1,
  title: SECRET,
  updatedAt: "2026-03-02T09:59:00.000Z",
  pad: " ",
};

function header(id = SESSION, cwd = "/work/project") {
  return { type: "session", version: 3, id, timestamp: "2026-03-02T09:59:00.000Z", cwd };
}

function user(id: string, parentId: string | null) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-03-02T10:00:00.000Z",
    message: { role: "user", content: SECRET, timestamp: 1_772_445_600_000 },
  };
}

function assistant(
  id: string,
  parentId: string | null,
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoningTokens?: number;
    cost?: number;
  },
  extra: { provider?: string; model?: string; timestamp?: string; stopReason?: string } = {},
) {
  const { cost = 0, ...tokens } = usage;
  return {
    type: "message",
    id,
    parentId,
    timestamp: extra.timestamp ?? "2026-03-02T10:00:05.000Z",
    message: {
      role: "assistant",
      content: [{ type: "text", text: SECRET }],
      api: "openai-codex-responses",
      provider: extra.provider ?? "openai-codex",
      model: extra.model ?? "gpt-synthetic-1",
      usage: {
        ...tokens,
        // OMP's total leaves reasoningTokens out: they are already part of output.
        totalTokens: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
      },
      stopReason: extra.stopReason ?? "stop",
      timestamp: 1_772_445_601_000,
    },
  };
}

describe("Omp native usage", () => {
  it("reads assistant usage with its Provider after the title slot", async () => {
    const f = await fixture();
    await writeFile(
      f.file,
      lines(
        TITLE,
        header(),
        { type: "model_change", id: "m-1", parentId: null, model: "Anthropic/claude-synthetic-1" },
        user("u-1", "m-1"),
        assistant("a-1", "u-1", {
          input: 100,
          output: 50,
          cacheRead: 1_000,
          cacheWrite: 10,
          reasoningTokens: 20,
        }),
        assistant(
          "a-2",
          "a-1",
          { input: 5, output: 7, cacheRead: 0, cacheWrite: 3, cost: 0.25 },
          {
            provider: "Anthropic",
            model: "claude-synthetic-1",
            timestamp: "2026-03-02T10:01:00.000Z",
          },
        ),
      ),
    );

    const batch = await f.read();
    expect(batch.records).toEqual([
      {
        dedupeKey: expect.any(String),
        occurredAt: Date.parse("2026-03-02T10:00:05.000Z"),
        nativeSessionId: SESSION,
        provider: "openai-codex",
        model: "gpt-synthetic-1",
        cwd: "/work/project",
        tokens: { input: 100, cacheRead: 1_000, cacheWrite: 10, output: 30, reasoning: 20 },
        conversations: 1,
      },
      {
        dedupeKey: expect.any(String),
        occurredAt: Date.parse("2026-03-02T10:01:00.000Z"),
        nativeSessionId: SESSION,
        provider: "Anthropic",
        model: "claude-synthetic-1",
        cwd: "/work/project",
        tokens: { input: 5, cacheRead: 0, cacheWrite: 3, output: 7, reasoning: 0 },
        conversations: 1,
        reportedCostUsd: 0.25,
      },
    ]);
    // Usage never carries message text; a Session's title is its own or its first message.
    expect(JSON.stringify(batch.records)).not.toContain(SECRET);
  });

  it("accepts a header on the first line and counts every assistant message as a conversation", async () => {
    const f = await fixture();
    await writeFile(
      f.file,
      lines(
        header(),
        user("u-1", null),
        assistant(
          "a-1",
          "u-1",
          { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          { stopReason: "error" },
        ),
      ),
    );

    const { records } = await f.read();
    expect(records).toEqual([
      {
        dedupeKey: expect.any(String),
        occurredAt: Date.parse("2026-03-02T10:00:05.000Z"),
        nativeSessionId: SESSION,
        provider: "openai-codex",
        cwd: "/work/project",
        tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
        conversations: 1,
      },
    ]);
  });

  it("includes subagent sessions and gives entries copied into a fork the same key", async () => {
    const f = await fixture();
    const reply = assistant("a-1", "u-1", { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 });
    await writeFile(f.file, lines(TITLE, header(), user("u-1", null), reply));
    await writeFile(
      path.join(f.project, `2026-03-02T11-00-00-000Z_${FORK}.jsonl`),
      lines(TITLE, header(FORK), user("u-1", null), reply),
    );
    // Subagents live in a folder named after the parent file, and may nest further.
    const nested = path.join(f.project, SESSION_FILE, "Reviewer");
    await mkdir(nested, { recursive: true });
    await writeFile(
      path.join(f.project, SESSION_FILE, "Reviewer.jsonl"),
      lines(
        TITLE,
        { ...header(CHILD), parentSession: SESSION },
        assistant("c-1", null, { input: 4, output: 5, cacheRead: 6, cacheWrite: 0 }),
      ),
    );
    await writeFile(
      path.join(nested, "Probe.jsonl"),
      lines(
        TITLE,
        header(FORK.replace(/5$/u, "6")),
        assistant("c-2", null, { input: 7, output: 8, cacheRead: 9, cacheWrite: 0 }),
      ),
    );

    const progress: HarnessNativeUsageProgress[] = [];
    const { records } = await f.read(null, (reported) => progress.push(reported));
    expect(progress.map(({ processed, total }) => `${processed}/${total}`)).toEqual([
      "0/4",
      "1/4",
      "2/4",
      "3/4",
      "4/4",
    ]);
    expect(records).toHaveLength(4);
    expect(new Set(records.map((record) => record.dedupeKey)).size).toBe(3);
    expect(records.map((record) => record.tokens.input).sort()).toEqual([1, 1, 4, 7]);
    expect(records.find((record) => record.tokens.input === 4)?.nativeSessionId).toBe(CHILD);
  });

  it("reads only complete lines, waits for the header and resumes after them", async () => {
    const f = await fixture();
    // OMP writes the title slot before the header; until the header is complete nothing is known.
    await writeFile(f.file, lines(TITLE) + JSON.stringify(header()).slice(0, 20));
    const empty = await f.read();
    expect(empty.records).toEqual([]);

    const second = JSON.stringify(
      assistant(
        "a-2",
        "a-1",
        { input: 4, output: 5, cacheRead: 6, cacheWrite: 0 },
        { timestamp: "2026-03-02T11:00:00.000Z" },
      ),
    );
    await writeFile(
      f.file,
      lines(
        TITLE,
        header(),
        assistant("a-1", null, { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 }),
      ) + second.slice(0, 40),
    );
    const first = await f.read(empty.cursor);
    expect(first.records.map((record) => record.tokens.input)).toEqual([1]);

    await appendFile(f.file, `${second.slice(40)}\n`);
    const next = await f.read(first.cursor);
    expect(next.records).toHaveLength(1);
    expect(next.records[0]).toMatchObject({
      nativeSessionId: SESSION,
      cwd: "/work/project",
      tokens: { input: 4, output: 5, cacheRead: 6 },
    });
    expect((await f.read(next.cursor)).records).toEqual([]);
  });

  it("rereads from the start with stable keys when the cursor is unknown or the file is replaced", async () => {
    const f = await fixture();
    await writeFile(
      f.file,
      lines(
        TITLE,
        header(),
        assistant("a-1", null, { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 }),
      ),
    );
    const first = await f.read();

    const unknown = await f.read({ formatVersion: 99 });
    expect(unknown.records.map((record) => record.dedupeKey)).toEqual(
      first.records.map((record) => record.dedupeKey),
    );
    const damaged = await f.read({
      formatVersion: 1,
      files: {
        ...(first.cursor as { files: Record<string, JsonValue> }).files,
        "other.jsonl": { ino: 1, offset: 0, session: null },
      },
    });
    expect(damaged.records).toHaveLength(1);

    await rm(f.file);
    await writeFile(
      f.file,
      lines(
        header(SESSION, "/w"),
        assistant("a-1", null, { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 }),
      ),
    );
    const replaced = await f.read(first.cursor);
    expect(replaced.records.map((record) => record.dedupeKey)).toEqual(
      first.records.map((record) => record.dedupeKey),
    );
  });

  it("returns an empty batch without a sessions directory and skips files that are not OMP sessions", async () => {
    const f = await fixture();
    await rm(path.join(f.agent, "sessions"), { recursive: true });
    expect((await f.read()).records).toEqual([]);

    await mkdir(f.project, { recursive: true });
    await writeFile(
      f.file,
      lines(
        TITLE,
        { type: "note" },
        header(),
        assistant("a-1", null, { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 }),
      ),
    );
    expect((await f.read()).records).toEqual([]);
  });

  it("follows OMP's session directory overrides", async () => {
    const root = await temporaryRoot();
    const write = async (directory: string, id: string) => {
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, `${id}.jsonl`),
        lines(
          TITLE,
          header(id),
          assistant("a-1", null, { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 }),
        ),
      );
    };
    const ids = async (environment: NodeJS.ProcessEnv) =>
      (await reader(environment)()).records.map((record) => record.nativeSessionId);
    await write(path.join(root, ".omp", "agent", "sessions", "-p"), "default");
    await write(path.join(root, ".config-omp", "agent", "sessions", "-p"), "config");
    await write(path.join(root, "flat"), "flat");

    expect(await ids({ HOME: root, USERPROFILE: root })).toEqual(["default"]);
    expect(await ids({ HOME: root, USERPROFILE: root, PI_CONFIG_DIR: ".config-omp" })).toEqual([
      "config",
    ]);
    expect(
      await ids({ HOME: root, USERPROFILE: root, PI_CODING_AGENT_SESSION_DIR: `${root}/flat` }),
    ).toEqual(["flat"]);

    // OMP moves the default agent's data under $XDG_DATA_HOME/omp only when that folder exists.
    const xdg = path.join(root, "xdg");
    const xdgEnvironment = { HOME: root, USERPROFILE: root, XDG_DATA_HOME: xdg };
    expect(await ids(xdgEnvironment)).toEqual(["default"]);
    await write(path.join(xdg, "omp", "sessions", "-p"), "xdg");
    expect(await ids(xdgEnvironment)).toEqual(["xdg"]);
    expect(
      await ids({ ...xdgEnvironment, PI_CODING_AGENT_DIR: path.join(root, ".omp", "agent") }),
    ).toEqual(["xdg"]);
  });
  it("summarizes sessions with their title slot, turns, edits, subagents and forks", async () => {
    const f = await fixture();
    const slot = (title: string) =>
      JSON.stringify({ ...TITLE, title, pad: " ".repeat(40 - title.length) });
    const editing = assistant("a-1", "u-1", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
    editing.message.content = [
      { type: "toolCall", id: "t-1", name: "write", arguments: {} } as never,
    ];
    await writeFile(
      f.file,
      `${slot("")}\n` +
        lines({ ...header(), title: "Header title" }, user("u-1", null), editing, {
          ...user("u-2", "a-1"),
          timestamp: "2026-03-02T10:05:00.000Z",
        }),
    );
    // Subagents live in a folder named after the parent's file, possibly nested.
    const agents = path.join(f.project, SESSION_FILE);
    await mkdir(path.join(agents, "Scout"), { recursive: true });
    await writeFile(path.join(agents, "Scout.jsonl"), lines(header(CHILD), user("c-1", null)));
    await writeFile(
      path.join(agents, "Scout", "Scout.Nested.jsonl"),
      lines(header("nested-id"), user("n-1", null)),
    );
    await writeFile(
      path.join(f.project, `2026-03-02T11-00-00-000Z_${FORK}.jsonl`),
      lines({ ...header(FORK), parentSession: f.file }, user("f-1", null)),
    );
    const first = await f.read();
    expect(first.sessions).toEqual(
      expect.arrayContaining([
        {
          key: path.relative(path.join(f.agent, "sessions"), f.file),
          nativeSessionId: SESSION,
          title: "Header title",
          cwd: "/work/project",
          model: "gpt-synthetic-1",
          firstActivityAt: Date.parse("2026-03-02T09:59:00.000Z"),
          lastActivityAt: Date.parse("2026-03-02T10:05:00.000Z"),
          activeMs: 6 * 60_000,
          turns: 2,
          edits: 1,
        },
        expect.objectContaining({ nativeSessionId: CHILD, parentSessionId: SESSION, turns: 1 }),
        expect.objectContaining({ nativeSessionId: "nested-id", parentSessionId: CHILD }),
        expect.objectContaining({ nativeSessionId: FORK }),
      ]),
    );
    expect(first.sessions).toHaveLength(4);
    // A fork is a Session of its own, resumed on its own.
    expect(
      first.sessions?.find(({ nativeSessionId }) => nativeSessionId === FORK),
    ).not.toHaveProperty("parentSessionId");
    expect((await f.read(first.cursor)).sessions).toEqual([]);

    // OMP names the session by rewriting the slot in place, without appending anything.
    const handle = await open(f.file, "r+");
    await handle.write(slot("Named"), 0);
    await handle.close();
    const later = new Date(Date.now() + 5_000);
    await utimes(f.file, later, later);
    expect((await f.read(first.cursor)).sessions).toEqual([
      expect.objectContaining({ nativeSessionId: SESSION, title: "Named", turns: 2 }),
    ]);
  });
});
