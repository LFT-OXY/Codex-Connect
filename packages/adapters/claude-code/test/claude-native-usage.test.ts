import { appendFile, mkdtemp, mkdir, realpath, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { HarnessNativeUsageBatch } from "@codexhost/harness-adapter";
import type { JsonValue } from "@codexhost/shared-contracts";
import { afterEach, describe, expect, it } from "vitest";

import { ClaudeCodeAdapter } from "../src/claude-code-adapter.js";

const roots: string[] = [];
const adapters: ClaudeCodeAdapter[] = [];

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const SESSION = "11111111-1111-4111-8111-111111111111";
const SECRET = "SYNTHETIC-PRIVATE-TEXT";

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "codexhost-claude-usage-")));
  roots.push(root);
  const config = path.join(root, "claude");
  const project = path.join(config, "projects", "-encoded-project");
  await mkdir(project, { recursive: true });
  const adapter = new ClaudeCodeAdapter({ environment: { CLAUDE_CONFIG_DIR: config } });
  adapters.push(adapter);
  const mainFile = path.join(project, `${SESSION}.jsonl`);
  const subagentFile = path.join(project, SESSION, "subagents", "agent-a1.jsonl");
  const read = async (cursor: JsonValue | null = null): Promise<HarnessNativeUsageBatch> => {
    const result = await adapter.nativeUsage.read(cursor);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  return { root, config, project, mainFile, subagentFile, read };
}

function lines(...entries: unknown[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

function user(uuid: string, content: unknown, extra: Record<string, unknown> = {}) {
  return {
    type: "user",
    uuid,
    isSidechain: false,
    sessionId: SESSION,
    cwd: "/work/project",
    timestamp: "2026-03-02T10:00:00.000Z",
    message: { role: "user", content },
    ...extra,
  };
}

function assistant(
  messageId: string,
  usage: Record<string, number>,
  extra: Record<string, unknown> = {},
  stopReason: string | null = "end_turn",
) {
  return {
    type: "assistant",
    uuid: `${messageId}-${Math.random()}`,
    isSidechain: false,
    sessionId: SESSION,
    cwd: "/work/project",
    requestId: `req-${messageId}`,
    timestamp: "2026-03-02T10:00:05.000Z",
    message: {
      id: messageId,
      model: "claude-synthetic-1",
      role: "assistant",
      stop_reason: stopReason,
      content: [{ type: "text", text: SECRET }],
      usage,
    },
    ...extra,
  };
}

const USAGE = {
  input_tokens: 3,
  cache_read_input_tokens: 100,
  cache_creation_input_tokens: 20,
  output_tokens: 7,
};

describe("Claude Code native usage", () => {
  it("counts each native message once, with subagent usage and main-session prompts only", async () => {
    const f = await fixture();
    await writeFile(
      f.mainFile,
      lines(
        user("u-1", `${SECRET} typed prompt`),
        // One response is written once per content block with the same final usage.
        assistant("msg-1", USAGE),
        assistant("msg-1", USAGE),
        user("u-2", [{ type: "tool_result", tool_use_id: "t", content: SECRET }]),
        user("u-3", [{ type: "text", text: SECRET }]),
        user("u-4", "older sidechain prompt", { isSidechain: true }),
        assistant("msg-empty", { input_tokens: 0, output_tokens: 0 }),
      ),
    );
    await mkdir(path.dirname(f.subagentFile), { recursive: true });
    await writeFile(
      f.subagentFile,
      lines(
        user("u-5", "subagent task", { isSidechain: true }),
        // Subagent transcripts stream a partial usage before the final one.
        assistant("msg-2", { ...USAGE, output_tokens: 1 }, { isSidechain: true }, null),
        assistant("msg-2", { ...USAGE, output_tokens: 50 }, { isSidechain: true }, "tool_use"),
        user("u-6", [{ type: "tool_result", tool_use_id: "t", content: "x" }], {
          isSidechain: true,
        }),
      ),
    );

    const batch = await f.read();
    expect(JSON.stringify(batch)).not.toContain(SECRET);
    const usage = batch.records.filter((record) => record.conversations === 0);
    expect(usage).toHaveLength(2);
    expect(usage.find((record) => record.tokens.output === 7)).toEqual({
      dedupeKey: expect.any(String),
      occurredAt: Date.parse("2026-03-02T10:00:05.000Z"),
      nativeSessionId: SESSION,
      model: "claude-synthetic-1",
      cwd: "/work/project",
      tokens: { input: 3, cacheRead: 100, cacheWrite: 20, output: 7, reasoning: 0 },
      conversations: 0,
    });
    expect(usage.find((record) => record.tokens.output === 50)).toMatchObject({
      nativeSessionId: SESSION,
      model: "claude-synthetic-1",
    });
    const prompts = batch.records.filter((record) => record.conversations > 0);
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt).toEqual({
        dedupeKey: expect.any(String),
        occurredAt: Date.parse("2026-03-02T10:00:00.000Z"),
        nativeSessionId: SESSION,
        cwd: "/work/project",
        tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
        conversations: 1,
      });
    }
    expect(new Set(batch.records.map((record) => record.dedupeKey)).size).toBe(4);
  });

  it("reads only appended complete lines from the returned cursor", async () => {
    const f = await fixture();
    await writeFile(f.mainFile, lines(user("u-1", "first"), assistant("msg-1", USAGE)));
    const first = await f.read();
    expect(first.records).toHaveLength(2);

    expect((await f.read(first.cursor)).records).toEqual([]);

    const next = JSON.stringify(assistant("msg-2", USAGE));
    await appendFile(f.mainFile, `${JSON.stringify(user("u-2", "second"))}\n${next.slice(0, 40)}`);
    const partial = await f.read(first.cursor);
    expect(partial.records.map((record) => record.conversations)).toEqual([1]);

    await appendFile(f.mainFile, `${next.slice(40)}\n`);
    const completed = await f.read(partial.cursor);
    expect(completed.records).toHaveLength(1);
    expect(completed.records[0]).toMatchObject({ conversations: 0, tokens: { output: 7 } });
  });

  it("waits for a streaming response to finish before reporting its usage", async () => {
    const f = await fixture();
    await mkdir(path.dirname(f.subagentFile), { recursive: true });
    await writeFile(
      f.subagentFile,
      lines(assistant("msg-1", { ...USAGE, output_tokens: 1 }, { isSidechain: true }, null)),
    );
    const streaming = await f.read();
    expect(streaming.records).toEqual([]);

    await appendFile(
      f.subagentFile,
      lines(assistant("msg-1", { ...USAGE, output_tokens: 90 }, { isSidechain: true }, "end_turn")),
    );
    const finished = await f.read(streaming.cursor);
    expect(finished.records).toHaveLength(1);
    expect(finished.records[0]?.tokens.output).toBe(90);
  });

  it("keeps waiting when tool results are written before the response's final usage", async () => {
    const f = await fixture();
    await mkdir(path.dirname(f.subagentFile), { recursive: true });
    // Tools start while the response still streams, so their results precede its final line.
    await writeFile(
      f.subagentFile,
      lines(
        assistant("msg-1", { ...USAGE, output_tokens: 5 }, { isSidechain: true }, null),
        user("u-1", [{ type: "tool_result", tool_use_id: "t", content: "x" }], {
          isSidechain: true,
        }),
      ),
    );
    const streaming = await f.read();
    expect(streaming.records).toEqual([]);

    await appendFile(
      f.subagentFile,
      lines(
        assistant("msg-1", { ...USAGE, output_tokens: 460 }, { isSidechain: true }, "tool_use"),
      ),
    );
    const finished = await f.read(streaming.cursor);
    expect(finished.records.map((record) => record.tokens.output)).toEqual([460]);
  });

  it("reports the last usage of a response that stopped streaming in a transcript idle for an hour", async () => {
    const f = await fixture();
    await writeFile(
      f.mainFile,
      lines(assistant("msg-1", { ...USAGE, output_tokens: 5 }, {}, null)),
    );
    const idle = new Date(Date.now() - 2 * 60 * 60_000);
    await utimes(f.mainFile, idle, idle);
    const batch = await f.read();
    expect(batch.records.map((record) => record.tokens.output)).toEqual([5]);
    expect((await f.read(batch.cursor)).records).toEqual([]);
  });

  it("rereads a replaced file and treats a missing store or unknown cursor as a fresh start", async () => {
    const f = await fixture();
    expect(await f.read()).toMatchObject({ records: [] });
    await writeFile(f.mainFile, lines(assistant("msg-1", USAGE), assistant("msg-2", USAGE)));
    const first = await f.read();
    expect(first.records).toHaveLength(2);

    await rm(f.mainFile);
    await writeFile(f.mainFile, lines(assistant("msg-3", USAGE)));
    expect((await f.read(first.cursor)).records).toHaveLength(1);

    expect((await f.read({ unknown: true })).records).toHaveLength(1);
  });
});
