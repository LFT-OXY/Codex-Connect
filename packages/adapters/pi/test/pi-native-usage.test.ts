import { appendFile, mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  HarnessNativeUsageBatch,
  HarnessNativeUsageProgress,
} from "@codexhost/harness-adapter";
import type { JsonValue } from "@codexhost/shared-contracts";
import { afterEach, describe, expect, it } from "vitest";

import { PiAdapter } from "../src/pi-adapter.js";

const roots: string[] = [];
const adapters: PiAdapter[] = [];

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const SESSION = "019fae1c-5b8a-7a9f-9071-16ff0f108bc2";
const FORK = "019fae1c-5b8a-7a9f-9071-16ff0f108bc3";
const SECRET = "SYNTHETIC-PRIVATE-TEXT";

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "codexhost-pi-usage-")));
  roots.push(root);
  const agent = path.join(root, "agent");
  const project = path.join(agent, "sessions", "--work-project--");
  await mkdir(project, { recursive: true });
  const adapter = new PiAdapter({ environment: { PI_CODING_AGENT_DIR: agent } });
  adapters.push(adapter);
  const read = async (
    cursor: JsonValue | null = null,
    onProgress?: (progress: HarnessNativeUsageProgress) => void,
  ): Promise<HarnessNativeUsageBatch> => {
    const result = await adapter.nativeUsage.read(cursor, onProgress);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  return { agent, project, file: path.join(project, `${SESSION}.jsonl`), read };
}

function lines(...entries: unknown[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

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
    reasoning?: number;
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
      api: "openai-responses",
      provider: extra.provider ?? "synthetic-gpt",
      model: extra.model ?? "gpt-synthetic-1",
      usage: {
        ...tokens,
        totalTokens: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
      },
      stopReason: extra.stopReason ?? "stop",
      timestamp: 1_772_445_601_000,
    },
  };
}

describe("Pi native usage", () => {
  it("reads assistant usage with its Provider under PI_CODING_AGENT_DIR", async () => {
    const f = await fixture();
    await writeFile(
      f.file,
      lines(
        header(),
        { type: "model_change", id: "m-1", parentId: null, provider: "p", modelId: "x" },
        user("u-1", "m-1"),
        assistant("a-1", "u-1", {
          input: 100,
          output: 50,
          cacheRead: 1_000,
          cacheWrite: 10,
          reasoning: 20,
        }),
        assistant(
          "a-2",
          "a-1",
          { input: 5, output: 7, cacheRead: 0, cacheWrite: 3, cost: 0.25 },
          {
            provider: "anthropic",
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
        provider: "synthetic-gpt",
        model: "gpt-synthetic-1",
        cwd: "/work/project",
        // Pi's reasoning is part of its output; it moves to its own column, never counted twice.
        tokens: { input: 100, cacheRead: 1_000, cacheWrite: 10, output: 30, reasoning: 20 },
        conversations: 1,
      },
      {
        dedupeKey: expect.any(String),
        occurredAt: Date.parse("2026-03-02T10:01:00.000Z"),
        nativeSessionId: SESSION,
        provider: "anthropic",
        model: "claude-synthetic-1",
        cwd: "/work/project",
        tokens: { input: 5, cacheRead: 0, cacheWrite: 3, output: 7, reasoning: 0 },
        conversations: 1,
        reportedCostUsd: 0.25,
      },
    ]);
    // Usage never carries message text; an unnamed Session's title is its first message.
    expect(JSON.stringify(batch.records)).not.toContain(SECRET);
  });

  it("counts every assistant message as a conversation, even without tokens", async () => {
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
        provider: "synthetic-gpt",
        cwd: "/work/project",
        tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
        conversations: 1,
      },
    ]);
  });

  it("gives entries copied into a fork the same key as the original", async () => {
    const f = await fixture();
    const reply = assistant("a-1", "u-1", { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 });
    await writeFile(f.file, lines(header(), user("u-1", null), reply));
    await writeFile(
      path.join(f.project, `${FORK}.jsonl`),
      lines(
        header(FORK),
        user("u-1", null),
        reply,
        assistant(
          "a-2",
          "a-1",
          { input: 4, output: 5, cacheRead: 6, cacheWrite: 0 },
          { timestamp: "2026-03-02T11:00:00.000Z" },
        ),
      ),
    );

    const { records } = await f.read();
    const keys = records.map((record) => record.dedupeKey);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(2);
    expect(records.map((record) => record.nativeSessionId).sort()).toEqual(
      [SESSION, FORK, FORK].sort(),
    );
  });

  it("includes subagent sessions kept inside a parent session's folder, reporting file progress", async () => {
    const f = await fixture();
    const child = path.join(f.project, SESSION, "tasks");
    await mkdir(child, { recursive: true });
    await writeFile(
      path.join(child, `${FORK}.jsonl`),
      lines(
        { ...header(FORK), parentSession: SESSION },
        assistant("c-1", null, { input: 4, output: 5, cacheRead: 6, cacheWrite: 0 }),
      ),
    );

    await writeFile(f.file, lines(header(), user("u-1", null)));
    const progress: HarnessNativeUsageProgress[] = [];
    const { records } = await f.read(null, (reported) => progress.push(reported));
    expect(records).toEqual([expect.objectContaining({ nativeSessionId: FORK, conversations: 1 })]);
    expect(progress).toEqual([
      { processed: 0, total: 2 },
      { processed: 1, total: 2 },
      { processed: 2, total: 2 },
    ]);
  });

  it("reads only complete lines and resumes after them", async () => {
    const f = await fixture();
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
        header(),
        assistant("a-1", null, { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 }),
      ) + second.slice(0, 40),
    );

    const first = await f.read();
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
      lines(header(), assistant("a-1", null, { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 })),
    );
    const first = await f.read();

    const unknown = await f.read({ formatVersion: 99 });
    expect(unknown.records.map((record) => record.dedupeKey)).toEqual(
      first.records.map((record) => record.dedupeKey),
    );
    // One malformed file entry invalidates the whole cursor rather than only that file.
    const damaged = await f.read({
      formatVersion: 1,
      files: {
        ...(first.cursor as { files: Record<string, JsonValue> }).files,
        "other.jsonl": { ino: 1, offset: 0, session: null },
      },
    });
    expect(damaged.records).toHaveLength(1);

    // Shorter than the cursor offset, so it is reread even if the file system reuses the inode.
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

  it("returns an empty batch without a sessions directory and skips files that are not Pi sessions", async () => {
    const f = await fixture();
    await rm(path.join(f.agent, "sessions"), { recursive: true });
    expect((await f.read()).records).toEqual([]);

    await mkdir(f.project, { recursive: true });
    await writeFile(
      f.file,
      lines(
        { type: "note" },
        assistant("a-1", null, { input: 1, output: 2, cacheRead: 3, cacheWrite: 0 }),
      ),
    );
    expect((await f.read()).records).toEqual([]);
  });
  it("summarizes each session with its name, turns, edits and parent, continuing from the cursor", async () => {
    const f = await fixture();
    const editing = assistant("a-1", "u-1", { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
    editing.message.content = [
      { type: "toolCall", id: "t-1", name: "edit", arguments: { path: SECRET } } as never,
    ];
    await writeFile(
      f.file,
      lines(header(), user("u-1", null), editing, {
        ...user("u-2", "a-1"),
        timestamp: "2026-03-02T10:10:00.000Z",
      }),
    );
    const subagents = path.join(f.project, SESSION, "tasks");
    await mkdir(subagents, { recursive: true });
    await writeFile(
      path.join(subagents, `${FORK}.jsonl`),
      lines({ ...header(FORK), parentSession: SESSION }, user("u-3", null)),
    );
    const forkFile = path.join(f.project, "2026-03-02T11-00-00-000Z_fork-id.jsonl");
    await writeFile(
      forkFile,
      lines({ ...header("fork-id"), parentSession: f.file.replace(SESSION, `2026_${SESSION}`) }),
    );
    const first = await f.read();
    expect(first.sessions).toEqual(
      expect.arrayContaining([
        {
          key: path.relative(path.join(f.agent, "sessions"), f.file),
          nativeSessionId: SESSION,
          // Unnamed sessions are titled by their first message, as Session import does.
          title: SECRET,
          cwd: "/work/project",
          model: "gpt-synthetic-1",
          firstActivityAt: Date.parse("2026-03-02T09:59:00.000Z"),
          lastActivityAt: Date.parse("2026-03-02T10:10:00.000Z"),
          activeMs: 11 * 60_000,
          turns: 2,
          edits: 1,
        },
        expect.objectContaining({ nativeSessionId: FORK, parentSessionId: SESSION, turns: 1 }),
        expect.objectContaining({ nativeSessionId: "fork-id" }),
      ]),
    );
    expect(first.sessions).toHaveLength(3);
    // A fork names its source file; it is a Session of its own, resumed on its own.
    expect(
      first.sessions?.find(({ nativeSessionId }) => nativeSessionId === "fork-id"),
    ).not.toHaveProperty("parentSessionId");
    expect((await f.read(first.cursor)).sessions).toEqual([]);

    await appendFile(
      f.file,
      lines({
        type: "session_info",
        id: "i-1",
        parentId: "u-2",
        timestamp: "2026-03-02T10:11:00.000Z",
        name: " Named ",
      }),
    );
    expect((await f.read(first.cursor)).sessions).toEqual([
      expect.objectContaining({
        nativeSessionId: SESSION,
        title: "Named",
        turns: 2,
        edits: 1,
        activeMs: 12 * 60_000,
      }),
    ]);
  });
});
