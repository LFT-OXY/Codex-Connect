import { appendFile, mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ClaudeCodeAdapter } from "@codexhost/adapter-claude-code";
import type { HarnessAdapter } from "@codexhost/harness-adapter";
import { MappingStore } from "@codexhost/mapping-store";
import {
  harnessPluginDescriptorSchema,
  jsonRpcRequestSchema,
  localSessionsQueryResultSchema,
  type JsonObject,
} from "@codexhost/shared-contracts";
import { afterEach, describe, expect, it } from "vitest";

import { ExternalThreadRepository } from "../src/external-thread-repository.js";
import { LocalUsageService, localSessionMappings } from "../src/local-usage-service.js";
import { SessionImportRequests } from "../src/session-import-requests.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

const MAIN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SECRET = "SYNTHETIC-PRIVATE-TEXT";
const NOW = Date.parse("2026-03-04T12:00:00.000Z");

function lines(...entries: unknown[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

function user(sessionId: string, cwd: string, timestamp: string, content: unknown, extra = {}) {
  return {
    type: "user",
    uuid: `u-${timestamp}`,
    isSidechain: false,
    sessionId,
    cwd,
    timestamp,
    message: { role: "user", content },
    ...extra,
  };
}

function assistant(
  sessionId: string,
  cwd: string,
  id: string,
  timestamp: string,
  tokens: { input: number; output: number },
  content: unknown[] = [{ type: "text", text: SECRET }],
  extra = {},
) {
  return {
    type: "assistant",
    uuid: `a-${id}`,
    isSidechain: false,
    sessionId,
    cwd,
    requestId: `req-${id}`,
    timestamp,
    message: {
      id,
      model: "claude-synthetic-1",
      role: "assistant",
      stop_reason: "end_turn",
      content,
      usage: {
        input_tokens: tokens.input,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: tokens.output,
      },
    },
    ...extra,
  };
}

const PRICES = {
  "claude-synthetic-1": {
    mode: "chat",
    input_cost_per_token: 1 / 1e6,
    output_cost_per_token: 2 / 1e6,
    cache_read_input_token_cost: 0,
    cache_creation_input_token_cost: 0,
  },
};

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "codexhost-local-sessions-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, "work", "project");
  await mkdir(cwd, { recursive: true });
  const config = path.join(root, "claude");
  const project = path.join(config, "projects", "-work-project");
  await mkdir(path.join(project, MAIN, "subagents"), { recursive: true });
  const mainFile = path.join(project, `${MAIN}.jsonl`);
  await writeFile(
    mainFile,
    lines(
      user(MAIN, cwd, "2026-03-02T10:00:00.000Z", SECRET),
      assistant(MAIN, cwd, "msg-1", "2026-03-02T10:10:00.000Z", { input: 100, output: 10 }, [
        { type: "tool_use", id: "t-1", name: "Edit", input: { file_path: SECRET } },
      ]),
      user(MAIN, cwd, "2026-03-02T10:11:00.000Z", [
        { type: "tool_result", tool_use_id: "t-1", content: SECRET },
      ]),
      user(MAIN, cwd, "2026-03-02T10:12:00.000Z", "caveat", { isMeta: true }),
      user(MAIN, cwd, "2026-03-02T10:13:00.000Z", [
        { type: "text", text: "[Request interrupted by user]" },
      ]),
      // An hour idle: not active time.
      user(MAIN, cwd, "2026-03-02T11:13:00.000Z", [{ type: "text", text: SECRET }]),
      assistant(MAIN, cwd, "msg-2", "2026-03-02T11:14:00.000Z", { input: 200, output: 20 }),
      { type: "ai-title", aiTitle: "  Synthetic\n title  ", sessionId: MAIN },
    ),
  );
  await writeFile(
    path.join(project, MAIN, "subagents", "agent-a1.jsonl"),
    lines(
      user(MAIN, cwd, "2026-03-02T10:02:00.000Z", SECRET, { isSidechain: true, agentId: "a1" }),
      assistant(
        MAIN,
        cwd,
        "msg-sub",
        "2026-03-02T10:03:00.000Z",
        { input: 1_000, output: 100 },
        [{ type: "tool_use", id: "t-2", name: "Write", input: {} }],
        { isSidechain: true, agentId: "a1" },
      ),
    ),
  );
  await writeFile(
    path.join(project, `${OTHER}.jsonl`),
    lines(
      user(OTHER, cwd, "2026-03-03T09:00:00.000Z", SECRET),
      assistant(OTHER, cwd, "msg-3", "2026-03-03T09:01:00.000Z", { input: 5, output: 5 }),
    ),
  );
  const claude = new ClaudeCodeAdapter({ environment: { CLAUDE_CONFIG_DIR: config } });
  cleanup.push(() => claude.close());
  const repository = new ExternalThreadRepository(
    new MappingStore({ directory: path.join(root, "mappings") }),
  );
  await repository.initialize();
  cleanup.push(() => repository.close());
  const descriptors = () => [
    harnessPluginDescriptorSchema.parse({ id: "claude-code", name: "Claude Code", version: "0" }),
  ];
  const service = (others: [string, HarnessAdapter][] = []) =>
    new LocalUsageService({
      adapters: new Map<string, HarnessAdapter>([["claude-code", claude], ...others]),
      descriptors,
      mappings: async () => localSessionMappings(await repository.list()),
      directory: path.join(root, "data", "usage"),
      fetchLiteLlm: async () => PRICES,
      diagnose: () => undefined,
      now: () => NOW,
    });
  const imports = new SessionImportRequests({
    adapters: new Map<string, HarnessAdapter>([["claude-code", claude]]),
    descriptors,
    repository,
    diagnose: () => undefined,
  });
  return { root, cwd, mainFile, repository, service, imports };
}

async function sessions(service: LocalUsageService, refresh = true) {
  const body: JsonObject = await service.handleSessions(
    jsonRpcRequestSchema.parse({ id: 1, method: "codexhost/sessions/query", params: { refresh } }),
  );
  const parsed = localSessionsQueryResultSchema.parse(body.result);
  if (parsed.status !== "ready") throw new Error("Sessions are still being read");
  return { view: parsed, body };
}

describe("Local Sessions query", () => {
  it("lists main Claude Code Sessions with subagents folded in and no message text", async () => {
    const f = await fixture();
    const { view, body } = await sessions(f.service());
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(view.foldedSubagents).toBe(1);
    expect(view.harnesses).toEqual([{ harnessId: "claude-code", name: "Claude Code" }]);
    expect(view.failures).toEqual([]);
    expect(view.sessions.map(({ nativeSessionId }) => nativeSessionId)).toEqual([OTHER, MAIN]);
    expect(view.sessions[1]).toEqual({
      harnessId: "claude-code",
      nativeSessionId: MAIN,
      title: "Synthetic title",
      cwd: f.cwd,
      project: "project",
      model: "claude-synthetic-1",
      startedAt: Date.parse("2026-03-02T10:00:00.000Z"),
      lastActivityAt: Date.parse("2026-03-02T11:14:00.000Z"),
      // 13 minutes before the idle hour and 1 minute after it.
      activeMs: 14 * 60_000,
      // The subagent's usage is the main Session's too.
      usage: { totalTokens: 110 + 220 + 1_100, estimatedCostUsd: expect.any(Number) },
      // Tool results, metadata and interruption notices are not turns.
      turns: 2,
      // The first turn edited a file; the subagent's own edit is not the main Session's.
      edits: 1,
      subagents: 1,
      threadId: null,
      resumable: true,
      running: null,
    });
    expect(view.sessions[1]?.usage?.estimatedCostUsd).toBeCloseTo((1_300 + 130 * 2) / 1e6, 12);
  });

  it("marks a Session mapped by Resume, which reuses the Thread instead of importing again", async () => {
    const f = await fixture();
    const service = f.service();
    await sessions(service);
    const request = jsonRpcRequestSchema.parse({
      id: 2,
      method: "codexhost/harness/session-import/import",
      params: { harnessId: "claude-code", nativeSessionId: MAIN },
    });
    const first = await f.imports.handle(request);
    const threadId = (first.body.result as { threadId: string }).threadId;
    const again = await f.imports.handle(request);
    expect(again.body.result).toEqual({ threadId });
    expect(await f.repository.list()).toHaveLength(1);
    const { view } = await sessions(service, false);
    expect(view.sessions.find(({ nativeSessionId }) => nativeSessionId === MAIN)?.threadId).toBe(
      threadId,
    );
    expect(view.sessions.find(({ nativeSessionId }) => nativeSessionId === OTHER)?.threadId).toBe(
      null,
    );
  });

  it("adds records appended since the last read without counting earlier ones again", async () => {
    const f = await fixture();
    const service = f.service();
    await sessions(service);
    await appendFile(
      f.mainFile,
      lines(
        user(MAIN, f.cwd, "2026-03-02T11:20:00.000Z", "next"),
        assistant(MAIN, f.cwd, "msg-4", "2026-03-02T11:21:00.000Z", { input: 1, output: 1 }, [
          { type: "tool_use", id: "t-3", name: "MultiEdit", input: {} },
        ]),
      ),
    );
    const main = (await sessions(service)).view.sessions.find(
      ({ nativeSessionId }) => nativeSessionId === MAIN,
    );
    expect(main).toMatchObject({
      turns: 3,
      edits: 2,
      activeMs: 21 * 60_000,
      lastActivityAt: Date.parse("2026-03-02T11:21:00.000Z"),
      usage: { totalTokens: 1_430 + 2 },
    });
  });

  it("keeps listing other Harnesses' Sessions when one source fails", async () => {
    const f = await fixture();
    const failing = {
      harnessId: "pi",
      nativeUsage: { read: async () => ({ ok: false, error: { code: "internal", message: "x" } }) },
    } as unknown as HarnessAdapter;
    const { view } = await sessions(f.service([["pi", failing]]));
    expect(view.failures).toEqual([{ harnessId: "pi", name: "pi" }]);
    expect(view.sessions).toHaveLength(2);
  });
});
