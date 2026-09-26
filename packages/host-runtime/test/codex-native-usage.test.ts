import { appendFile, mkdtemp, mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { HarnessNativeUsageBatch } from "@codexhost/harness-adapter";
import type { JsonValue } from "@codexhost/shared-contracts";
import { afterEach, describe, expect, it } from "vitest";

import { codexNativeUsage } from "../src/codex-runtime/codex-native-usage.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const PARENT = "22222222-2222-4222-8222-222222222222";
const FORK = "33333333-3333-4333-8333-333333333333";
const SECRET = "SYNTHETIC-PRIVATE-TEXT";

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "codexhost-codex-usage-")));
  roots.push(root);
  const codexHome = path.join(root, "codex");
  const day = path.join(codexHome, "sessions", "2026", "03", "02");
  await mkdir(day, { recursive: true });
  const usage = codexNativeUsage(codexHome);
  const read = async (cursor: JsonValue | null = null): Promise<HarnessNativeUsageBatch> => {
    const result = await usage.read(cursor);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
  return { codexHome, day, read };
}

function lines(...entries: unknown[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

/** Codex counts cached and cache-written input inside `input_tokens`, reasoning inside output. */
function usage(input: number, cached: number, output: number, reasoning = 0, cacheWrite = 0) {
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    cache_write_input_tokens: cacheWrite,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: input + output,
  };
}

function meta(id: string, timestamp: string, extra: Record<string, unknown> = {}) {
  return {
    timestamp,
    type: "session_meta",
    payload: {
      id,
      timestamp,
      cwd: "/work/codex",
      originator: "codex_cli_rs",
      cli_version: "0.0.0",
      model_provider: "openai",
      base_instructions: { text: SECRET },
      ...extra,
    },
  };
}

function turnContext(timestamp: string, model: string, cwd = "/work/codex") {
  return { timestamp, type: "turn_context", payload: { turn_id: timestamp, cwd, model } };
}

function message(timestamp: string) {
  return {
    timestamp,
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: SECRET }] },
  };
}

function tokenCount(
  timestamp: string,
  total: ReturnType<typeof usage>,
  last: ReturnType<typeof usage>,
) {
  return {
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { total_token_usage: total, last_token_usage: last, model_context_window: 1_000 },
      rate_limits: null,
    },
  };
}

function rolloutName(time: string, id: string): string {
  return `rollout-${time}-${id}.jsonl`;
}

const PARENT_LINES = [
  meta(PARENT, "2026-03-02T10:00:00.000Z"),
  message("2026-03-02T10:00:01.000Z"),
  turnContext("2026-03-02T10:00:01.000Z", "gpt-synthetic-1"),
  tokenCount("2026-03-02T10:00:05.000Z", usage(100, 60, 10, 4), usage(100, 60, 10, 4)),
  // Codex repeats the latest totals, for example with a rate limit update.
  tokenCount("2026-03-02T10:00:06.000Z", usage(100, 60, 10, 4), usage(100, 60, 10, 4)),
  { timestamp: "2026-03-02T10:00:06.500Z", type: "event_msg", payload: { type: "token_count" } },
  turnContext("2026-03-02T10:01:00.000Z", "gpt-synthetic-2", "/work/other"),
  tokenCount("2026-03-02T10:01:05.000Z", usage(350, 260, 30, 10, 20), usage(250, 200, 20, 6, 20)),
];

describe("Codex native usage", () => {
  it("reads cumulative token counts as per-response differences without message text", async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.day, rolloutName("2026-03-02T10-00-00", PARENT)),
      lines(...PARENT_LINES),
    );
    const archived = path.join(f.codexHome, "archived_sessions");
    await mkdir(archived);
    await writeFile(
      path.join(archived, rolloutName("2026-03-01T09-00-00", FORK)),
      lines(
        meta(FORK, "2026-03-01T09:00:00.000Z", { model_provider: "azure" }),
        turnContext("2026-03-01T09:00:01.000Z", "gpt-synthetic-1"),
        tokenCount("2026-03-01T09:00:05.000Z", usage(7, 0, 3), usage(7, 0, 3)),
      ),
    );

    const batch = await f.read();

    expect(batch.records).toEqual([
      {
        dedupeKey: expect.any(String),
        occurredAt: Date.parse("2026-03-01T09:00:05.000Z"),
        nativeSessionId: FORK,
        provider: "azure",
        model: "gpt-synthetic-1",
        cwd: "/work/codex",
        tokens: { input: 7, cacheRead: 0, cacheWrite: 0, output: 3, reasoning: 0 },
        conversations: 1,
      },
      {
        dedupeKey: expect.any(String),
        occurredAt: Date.parse("2026-03-02T10:00:05.000Z"),
        nativeSessionId: PARENT,
        provider: "openai",
        model: "gpt-synthetic-1",
        cwd: "/work/codex",
        // Reasoning is already part of output and is not reported again.
        tokens: { input: 40, cacheRead: 60, cacheWrite: 0, output: 10, reasoning: 0 },
        conversations: 1,
      },
      {
        dedupeKey: expect.any(String),
        occurredAt: Date.parse("2026-03-02T10:01:05.000Z"),
        nativeSessionId: PARENT,
        provider: "openai",
        model: "gpt-synthetic-2",
        cwd: "/work/other",
        tokens: { input: 30, cacheRead: 200, cacheWrite: 20, output: 20, reasoning: 0 },
        conversations: 1,
      },
    ]);
    expect(new Set(batch.records.map((record) => record.dedupeKey)).size).toBe(3);
    expect(JSON.stringify(batch)).not.toContain(SECRET);
  });

  it("continues differences across incremental reads and leaves a partial line unread", async () => {
    const f = await fixture();
    const file = path.join(f.day, rolloutName("2026-03-02T10-00-00", PARENT));
    await writeFile(file, lines(...PARENT_LINES.slice(0, 4)));
    const first = await f.read();
    expect(first.records.map((record) => record.tokens.input)).toEqual([40]);

    const next = lines(...PARENT_LINES.slice(4));
    await appendFile(file, next.slice(0, -20));
    const partial = await f.read(first.cursor);
    expect(partial.records).toEqual([]);

    await appendFile(file, next.slice(-20));
    const rest = await f.read(partial.cursor);
    expect(rest.records.map((record) => [record.model, record.tokens])).toEqual([
      ["gpt-synthetic-2", { input: 30, cacheRead: 200, cacheWrite: 20, output: 20, reasoning: 0 }],
    ]);

    expect((await f.read(rest.cursor)).records).toEqual([]);
    // An unknown cursor restarts, and every repeated fact keeps its key.
    const again = await f.read({ formatVersion: 0 });
    expect(again.records.map((record) => record.dedupeKey)).toEqual([
      ...first.records.map((record) => record.dedupeKey),
      ...rest.records.map((record) => record.dedupeKey),
    ]);
  });

  it("keeps the keys of a fork's replayed history, so Host counts the parent once", async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.day, rolloutName("2026-03-02T10-00-00", PARENT)),
      lines(...PARENT_LINES),
    );
    // A fork replays the parent's rollout, stamped with the fork time, after its own metadata,
    // then keeps counting from the replayed totals.
    await writeFile(
      path.join(f.day, rolloutName("2026-03-02T11-00-00", FORK)),
      lines(
        meta(FORK, "2026-03-02T11:00:00.000Z", { forked_from_id: PARENT }),
        ...PARENT_LINES.map((line) => ({ ...line, timestamp: "2026-03-02T11:00:00.001Z" })),
        turnContext("2026-03-02T11:00:02.000Z", "gpt-synthetic-2"),
        tokenCount("2026-03-02T11:00:05.000Z", usage(400, 300, 35, 10, 20), usage(50, 40, 5)),
      ),
    );

    const { records } = await f.read();
    const parent = records.filter((record) => record.nativeSessionId === PARENT);
    const fork = records.filter((record) => record.nativeSessionId === FORK);
    expect(fork.slice(0, 2).map((record) => record.dedupeKey)).toEqual(
      parent.map((record) => record.dedupeKey),
    );
    expect(fork.slice(2)).toEqual([
      expect.objectContaining({
        occurredAt: Date.parse("2026-03-02T11:00:05.000Z"),
        tokens: { input: 10, cacheRead: 40, cacheWrite: 0, output: 5, reasoning: 0 },
        conversations: 1,
      }),
    ]);
    expect(parent.map((record) => record.dedupeKey)).not.toContain(fork[2]?.dedupeKey);

    // A fork of the fork replays both histories; only its own new count gets a new key.
    const forkLines = [
      meta(FORK, "2026-03-02T11:00:00.000Z", { forked_from_id: PARENT }),
      ...PARENT_LINES,
      tokenCount("2026-03-02T11:00:05.000Z", usage(400, 300, 35, 10, 20), usage(50, 40, 5)),
    ];
    const grandchild = "66666666-6666-4666-8666-666666666666";
    await writeFile(
      path.join(f.day, rolloutName("2026-03-02T12-00-00", grandchild)),
      lines(
        meta(grandchild, "2026-03-02T12:00:00.000Z", { forked_from_id: FORK }),
        ...forkLines.map((line) => ({ ...line, timestamp: "2026-03-02T12:00:00.001Z" })),
        tokenCount("2026-03-02T12:00:05.000Z", usage(410, 300, 36, 10, 20), usage(10, 0, 1)),
      ),
    );
    const again = await f.read();
    const earlierKeys = records.map((record) => record.dedupeKey);
    const own = again.records.filter((record) => record.nativeSessionId === grandchild);
    expect(own.slice(0, 3).map((record) => record.dedupeKey)).toEqual(earlierKeys.slice(2));
    expect(own.slice(3)).toEqual([
      expect.objectContaining({
        tokens: { input: 10, cacheRead: 0, cacheWrite: 0, output: 1, reasoning: 0 },
      }),
    ]);
    expect(earlierKeys).not.toContain(own[3]?.dedupeKey);
  });

  it("counts the last response when totals restart", async () => {
    const f = await fixture();
    await writeFile(
      path.join(f.day, rolloutName("2026-03-02T11-00-00", FORK)),
      lines(
        meta(FORK, "2026-03-02T11:00:00.000Z", { forked_from_id: PARENT }),
        // Current Codex replays no token counts and the fork's totals start from zero.
        meta(PARENT, "2026-03-02T10:00:00.000Z"),
        message("2026-03-02T11:00:00.001Z"),
        turnContext("2026-03-02T11:00:00.001Z", "gpt-synthetic-1"),
        tokenCount("2026-03-02T11:00:05.000Z", usage(500, 100, 50), usage(500, 100, 50)),
        tokenCount("2026-03-02T11:00:09.000Z", usage(120, 20, 8), usage(120, 20, 8)),
        tokenCount("2026-03-02T11:00:12.000Z", usage(150, 30, 10), usage(30, 10, 2)),
        // Totals can also restart above the previous ones; they then equal the last response.
        tokenCount("2026-03-02T11:00:15.000Z", usage(900, 700, 40), usage(900, 700, 40)),
      ),
    );

    const { records } = await f.read();
    expect(records.map((record) => [record.nativeSessionId, record.tokens])).toEqual([
      [FORK, { input: 400, cacheRead: 100, cacheWrite: 0, output: 50, reasoning: 0 }],
      [FORK, { input: 100, cacheRead: 20, cacheWrite: 0, output: 8, reasoning: 0 }],
      [FORK, { input: 20, cacheRead: 10, cacheWrite: 0, output: 2, reasoning: 0 }],
      [FORK, { input: 200, cacheRead: 700, cacheWrite: 0, output: 40, reasoning: 0 }],
    ]);
  });

  it("rereads a moved or replaced rollout with the same keys", async () => {
    const f = await fixture();
    const file = path.join(f.day, rolloutName("2026-03-02T10-00-00", PARENT));
    await writeFile(file, lines(...PARENT_LINES));
    const first = await f.read();

    const archived = path.join(f.codexHome, "archived_sessions");
    await mkdir(archived);
    await rename(file, path.join(archived, path.basename(file)));
    const moved = await f.read(first.cursor);
    expect(moved.records.map((record) => record.dedupeKey)).toEqual(
      first.records.map((record) => record.dedupeKey),
    );
  });

  it("reads nothing when Codex has no sessions", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "codexhost-codex-usage-")));
    roots.push(root);
    const result = await codexNativeUsage(path.join(root, "missing")).read(null);
    expect(result).toMatchObject({ ok: true, value: { records: [] } });
  });
});
