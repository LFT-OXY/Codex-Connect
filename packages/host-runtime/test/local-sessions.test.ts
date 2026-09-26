import { appendFile, mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ClaudeCodeAdapter } from "@codexhost/adapter-claude-code";
import { OmpAdapter } from "@codexhost/adapter-omp";
import { PiAdapter } from "@codexhost/adapter-pi";
import type { HarnessAdapter } from "@codexhost/harness-adapter";
import { MappingStore } from "@codexhost/mapping-store";
import {
  harnessPluginDescriptorSchema,
  jsonRpcRequestSchema,
  localSessionsQueryResultSchema,
  type JsonObject,
} from "@codexhost/shared-contracts";
import { afterEach, describe, expect, it } from "vitest";

import { codexNativeUsage } from "../src/codex-runtime/codex-native-usage.js";
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
  const codexHome = path.join(root, "codex");
  const service = (others: [string, HarnessAdapter][] = [], officialCodex = false) =>
    new LocalUsageService({
      adapters: new Map<string, HarnessAdapter>([["claude-code", claude], ...others]),
      ...(officialCodex ? { officialCodexUsage: codexNativeUsage(codexHome) } : {}),
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
  return { root, cwd, mainFile, codexHome, repository, service, imports };
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

  it("lists official Codex Sessions as their own Threads with child threads folded in", async () => {
    const f = await fixture();
    const day = path.join(f.codexHome, "sessions", "2026", "03", "03");
    await mkdir(day, { recursive: true });
    const PARENT = "01a0cbbd-4cfb-7771-ad32-a4ecf7f134f9";
    const CHILD = "01a0cbbd-4cfb-7771-ad32-a4ecf7f134fa";
    const rollout = (id: string, time: string, output: number, extra = {}) =>
      lines(
        {
          timestamp: time,
          type: "session_meta",
          payload: { id, cwd: f.cwd, model_provider: "openai", ...extra },
        },
        { timestamp: time, type: "turn_context", payload: { turn_id: id, cwd: f.cwd, model: "m" } },
        {
          timestamp: time,
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: { input_tokens: 10, output_tokens: output },
              last_token_usage: { input_tokens: 10, output_tokens: output },
            },
          },
        },
      );
    await writeFile(
      path.join(day, `rollout-2026-03-03T10-00-00-${PARENT}.jsonl`),
      rollout(PARENT, "2026-03-03T10:00:00.000Z", 5),
    );
    await writeFile(
      path.join(day, `rollout-2026-03-03T10-05-00-${CHILD}.jsonl`),
      rollout(CHILD, "2026-03-03T10:05:00.000Z", 7, { forked_from_id: PARENT }),
    );
    const { view } = await sessions(f.service([], true));
    const codex = view.sessions.filter(({ harnessId }) => harnessId === "codex");
    expect(codex).toEqual([
      expect.objectContaining({
        nativeSessionId: PARENT,
        threadId: PARENT,
        resumable: true,
        subagents: 1,
        turns: 1,
        lastActivityAt: Date.parse("2026-03-03T10:05:00.000Z"),
        usage: { totalTokens: 15 + 17, estimatedCostUsd: 0 },
      }),
    ]);
    expect(view.harnesses).toEqual(expect.arrayContaining([{ harnessId: "codex", name: "Codex" }]));
    expect(view.foldedSubagents).toBe(2);
  });

  it("lists Pi Sessions and resumes one through Pi's Session import", async () => {
    const f = await fixture();
    const sessionsDir = path.join(f.root, "pi-sessions");
    await mkdir(sessionsDir);
    const PI = "019fae1c-5b8a-7a9f-9071-16ff0f108bc2";
    await writeFile(
      path.join(sessionsDir, `2026-03-04T10-00-00-000Z_${PI}.jsonl`),
      lines(
        { type: "session", version: 3, id: PI, timestamp: "2026-03-04T10:00:00.000Z", cwd: f.cwd },
        {
          type: "message",
          id: "u-1",
          parentId: null,
          timestamp: "2026-03-04T10:00:01.000Z",
          message: { role: "user", content: "Pi title", timestamp: 1 },
        },
        {
          type: "message",
          id: "a-1",
          parentId: "u-1",
          timestamp: "2026-03-04T10:00:02.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: SECRET }],
            provider: "p",
            model: "claude-synthetic-1",
            usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0 },
            timestamp: 2,
          },
        },
      ),
    );
    const pi = new PiAdapter({ environment: { PI_CODING_AGENT_SESSION_DIR: sessionsDir } });
    cleanup.push(() => pi.close());
    const service = f.service([["pi", pi]]);
    const listed = (await sessions(service)).view.sessions.find(
      ({ harnessId }) => harnessId === "pi",
    );
    expect(listed).toMatchObject({
      nativeSessionId: PI,
      title: "Pi title",
      turns: 1,
      usage: { totalTokens: 7 },
      threadId: null,
      resumable: true,
    });
    const imports = new SessionImportRequests({
      adapters: new Map<string, HarnessAdapter>([["pi", pi]]),
      descriptors: () => [],
      repository: f.repository,
      diagnose: () => undefined,
    });
    const imported = await imports.handle(
      jsonRpcRequestSchema.parse({
        id: 3,
        method: "codexhost/harness/session-import/import",
        params: { harnessId: "pi", nativeSessionId: PI },
      }),
    );
    const { threadId } = imported.body.result as { threadId: string };
    const resumed = (await sessions(service, false)).view.sessions.find(
      ({ harnessId }) => harnessId === "pi",
    );
    expect(resumed?.threadId).toBe(threadId);
  });

  it("lists oh-my-pi Sessions with subagents folded in and resumes one through its import", async () => {
    const f = await fixture();
    const project = path.join(f.root, "omp", "sessions", "-project");
    const OMP = "01a079a2-95f5-7054-a6c6-935a64cfc2a8";
    const name = `2026-03-04T10-00-00-000Z_${OMP}`;
    await mkdir(path.join(project, name), { recursive: true });
    const session = (id: string, output: number) =>
      lines(
        { type: "title", v: 1, title: "", updatedAt: "2026-03-04T10:00:00.000Z", pad: "  " },
        { type: "session", version: 3, id, timestamp: "2026-03-04T10:00:00.000Z", cwd: f.cwd },
        {
          type: "message",
          id: `${id}-u`,
          parentId: null,
          timestamp: "2026-03-04T10:00:01.000Z",
          message: { role: "user", content: "Omp title", timestamp: 1 },
        },
        {
          type: "message",
          id: `${id}-a`,
          parentId: `${id}-u`,
          timestamp: "2026-03-04T10:00:02.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: SECRET }],
            provider: "p",
            model: "claude-synthetic-1",
            usage: { input: 1, output, cacheRead: 0, cacheWrite: 0 },
            timestamp: 2,
          },
        },
      );
    await writeFile(path.join(project, `${name}.jsonl`), session(OMP, 2));
    await writeFile(path.join(project, name, "Scout.jsonl"), session("scout-id", 4));
    const omp = new OmpAdapter({ environment: { PI_CODING_AGENT_DIR: path.join(f.root, "omp") } });
    cleanup.push(() => omp.close());
    const service = f.service([["omp", omp]]);
    const rows = (await sessions(service)).view.sessions.filter(
      ({ harnessId }) => harnessId === "omp",
    );
    expect(rows).toEqual([
      expect.objectContaining({
        nativeSessionId: OMP,
        title: "Omp title",
        subagents: 1,
        usage: { totalTokens: 3 + 5, estimatedCostUsd: expect.any(Number) },
        threadId: null,
        resumable: true,
      }),
    ]);
    const imports = new SessionImportRequests({
      adapters: new Map<string, HarnessAdapter>([["omp", omp]]),
      descriptors: () => [],
      repository: f.repository,
      diagnose: () => undefined,
    });
    const imported = await imports.handle(
      jsonRpcRequestSchema.parse({
        id: 4,
        method: "codexhost/harness/session-import/import",
        params: { harnessId: "omp", nativeSessionId: OMP },
      }),
    );
    const { threadId } = imported.body.result as { threadId: string };
    expect((await f.repository.list())[0]?.nativeSessionRef).toMatchObject({
      harnessId: "omp",
      locator: { sessionFile: path.join(project, `${name}.jsonl`) },
    });
    const resumed = (await sessions(service, false)).view.sessions.find(
      ({ harnessId }) => harnessId === "omp",
    );
    expect(resumed?.threadId).toBe(threadId);
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
