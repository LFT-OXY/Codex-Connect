import { appendFile, chmod, mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ClaudeCodeAdapter } from "@codexhost/adapter-claude-code";
import { OmpAdapter } from "@codexhost/adapter-omp";
import { PiAdapter } from "@codexhost/adapter-pi";
import type {
  HarnessAdapter,
  HarnessNativeUsageProgress as Progress,
} from "@codexhost/harness-adapter";
import {
  harnessPluginDescriptorSchema,
  jsonRpcRequestSchema,
  localUsageQueryResultSchema,
  type JsonObject,
  type JsonValue,
} from "@codexhost/shared-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { codexNativeUsage } from "../src/codex-runtime/codex-native-usage.js";
import { LocalUsageService } from "../src/local-usage-service.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const close of cleanup.splice(0).reverse()) await close();
});

const SESSION = "11111111-1111-4111-8111-111111111111";
// Wednesday. Asia/Shanghai is UTC+8 without daylight saving.
const NOW = Date.parse("2026-03-04T12:00:00.000Z");

function lines(...entries: unknown[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

function prompt(uuid: string, timestamp: string) {
  return {
    type: "user",
    uuid,
    isSidechain: false,
    sessionId: SESSION,
    cwd: "/work/project",
    timestamp,
    message: { role: "user", content: "synthetic prompt" },
  };
}

function response(
  id: string,
  timestamp: string,
  usage: { input: number; cacheRead: number; cacheWrite: number; output: number },
  model = "claude-synthetic-1",
) {
  return {
    type: "assistant",
    uuid: `uuid-${id}`,
    isSidechain: false,
    sessionId: SESSION,
    cwd: "/work/project",
    requestId: `req-${id}`,
    timestamp,
    message: {
      id,
      model,
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "synthetic answer" }],
      usage: {
        input_tokens: usage.input,
        cache_read_input_tokens: usage.cacheRead,
        cache_creation_input_tokens: usage.cacheWrite,
        output_tokens: usage.output,
      },
    },
  };
}

// Sunday 23:30 UTC is Monday 07:30 in Shanghai.
const SUNDAY_NIGHT_UTC = response("msg-a", "2026-03-01T23:30:00.000Z", {
  input: 1,
  cacheRead: 100,
  cacheWrite: 10,
  output: 5,
});
const MONDAY = response(
  "msg-b",
  "2026-03-02T10:00:00.000Z",
  { input: 2, cacheRead: 200, cacheWrite: 20, output: 7 },
  "claude-synthetic-2",
);
const PREVIOUS_FRIDAY = response("msg-c", "2026-02-27T10:00:00.000Z", {
  input: 4,
  cacheRead: 0,
  cacheWrite: 0,
  output: 1_000_000,
});

// USD per million tokens, as LiteLLM lists them per token.
function litellmPrices(
  prices: Record<
    string,
    [number, number, number, number] | [number, number, number, number, number]
  >,
) {
  return Object.fromEntries(
    Object.entries(prices).map(([model, [input, output, cacheRead, cacheWrite, cacheWrite1h]]) => [
      model,
      {
        mode: "chat",
        input_cost_per_token: input / 1e6,
        output_cost_per_token: output / 1e6,
        cache_read_input_token_cost: cacheRead / 1e6,
        cache_creation_input_token_cost: cacheWrite / 1e6,
        ...(cacheWrite1h === undefined
          ? {}
          : { cache_creation_input_token_cost_above_1hr: cacheWrite1h / 1e6 }),
      },
    ]),
  );
}
const PRICES = litellmPrices({
  "claude-synthetic-1": [1, 2, 0.1, 1, 1.6],
  "claude-synthetic-2": [2, 4, 0.2, 2],
  "gpt-synthetic-3": [1, 10, 0.1, 0],
});
// SUNDAY_NIGHT_UTC at claude-synthetic-1 plus MONDAY at claude-synthetic-2.
const WEEK_COST = (1 + 5 * 2 + 100 * 0.1 + 10 * 1 + (2 * 2 + 7 * 4 + 200 * 0.2 + 20 * 2)) / 1e6;

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "codexhost-local-usage-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const config = path.join(root, "claude");
  const project = path.join(config, "projects", "-work-project");
  await mkdir(project, { recursive: true });
  const mainFile = path.join(project, `${SESSION}.jsonl`);
  await writeFile(
    mainFile,
    lines(
      prompt("u-1", "2026-03-01T23:29:00.000Z"),
      SUNDAY_NIGHT_UTC,
      prompt("u-2", "2026-03-02T09:59:00.000Z"),
      MONDAY,
      PREVIOUS_FRIDAY,
    ),
  );
  const claude = new ClaudeCodeAdapter({ environment: { CLAUDE_CONFIG_DIR: config } });
  cleanup.push(() => claude.close());
  const read = vi.fn((cursor: JsonValue | null, onProgress?: (progress: Progress) => void) =>
    claude.nativeUsage.read(cursor, onProgress),
  );
  const adapter = {
    harnessId: claude.harnessId,
    nativeUsage: { read },
  } as unknown as HarnessAdapter;
  const codexHome = path.join(root, "codex");
  const directory = path.join(root, "data", "usage");
  const service = (
    options: {
      others?: [string, HarnessAdapter][];
      officialCodex?: boolean;
      names?: () => Record<string, string>;
      fetchLiteLlm?: () => Promise<unknown>;
      now?: () => number;
    } = {},
  ) =>
    new LocalUsageService({
      adapters: new Map([["claude-code", adapter], ...(options.others ?? [])]),
      descriptors: () =>
        Object.entries(options.names?.() ?? { "claude-code": "Claude Code" }).map(([id, name]) =>
          harnessPluginDescriptorSchema.parse({ id, name, version: "0.0.0" }),
        ),
      ...(options.officialCodex ? { officialCodexUsage: codexNativeUsage(codexHome) } : {}),
      directory,
      fetchLiteLlm: options.fetchLiteLlm ?? (async () => PRICES),
      diagnose: () => undefined,
      now: options.now ?? (() => NOW),
    });
  return { root, project, mainFile, codexHome, read, service };
}

async function query(service: LocalUsageService, params: unknown): Promise<JsonObject> {
  return service.handle(
    jsonRpcRequestSchema.parse({ id: 1, method: "codexhost/usage/query", params }),
  );
}

async function result(
  service: LocalUsageService,
  period: unknown,
  timeZone = "Asia/Shanghai",
  refresh = false,
) {
  const body = await query(service, { period, timeZone, refresh });
  const parsed = localUsageQueryResultSchema.parse(body.result);
  if (parsed.status !== "ready") throw new Error("Local usage is still being read");
  return parsed;
}

describe("Local Usage query", () => {
  it("totals native Claude Code usage by local calendar day and period", async () => {
    const f = await fixture();
    const service = f.service();

    const week = await result(service, { kind: "week" }, "Asia/Shanghai", true);
    expect(week.range).toEqual({ from: "2026-03-02", to: "2026-03-08" });
    expect(week.totals).toEqual({
      total: 116 + 229,
      input: 3,
      cacheRead: 300,
      cacheWrite: 30,
      output: 12,
      reasoning: 0,
      conversations: 2,
    });
    expect(week.models).toBe(2);
    expect(week.harnesses).toEqual([
      {
        harnessId: "claude-code",
        name: "Claude Code",
        totalTokens: 345,
        models: 2,
        providers: [],
      },
    ]);
    expect(week.daily).toEqual([
      {
        date: "2026-03-02",
        total: 345,
        input: 3,
        output: 12,
        cacheRead: 300,
        reasoning: 0,
        conversations: 2,
      },
    ]);

    // In UTC the Sunday-night response belongs to the previous week.
    const utcWeek = await result(service, { kind: "week" }, "UTC");
    expect(utcWeek.totals.total).toBe(229);
    expect(utcWeek.daily.map((day) => day.date)).toEqual(["2026-03-02"]);

    const day = await result(service, { kind: "day" });
    expect(day.range).toEqual({ from: "2026-03-04", to: "2026-03-04" });
    expect(day.totals.total).toBe(0);
    expect(day.harnesses).toEqual([]);
    expect(day.daily).toEqual([]);

    expect((await result(service, { kind: "month" })).range).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
    });
    const total = await result(service, { kind: "total" });
    expect(total.range).toEqual({ from: "2024-04-01", to: "2026-03-04" });
    expect(total.totals.total).toBe(345 + 1_000_004);
    expect(total.daily.map((row) => row.date)).toEqual(["2026-03-02", "2026-02-27"]);

    expect(week.estimatedCostUsd).toBeCloseTo(WEEK_COST, 12);
    expect(day.estimatedCostUsd).toBe(0);
    // PREVIOUS_FRIDAY: 4 input and one million output tokens of claude-synthetic-1.
    expect(total.estimatedCostUsd).toBeCloseTo(4 / 1e6 + 2 + WEEK_COST, 12);

    const custom = await result(service, { kind: "custom", from: "2026-02-27", to: "2026-03-01" });
    expect(custom.range).toEqual({ from: "2026-02-27", to: "2026-03-01" });
    expect(custom.totals.total).toBe(1_000_004);
    expect(f.read).toHaveBeenCalledOnce();
  });

  it("prices usage when queried, so price updates change earlier costs", async () => {
    const f = await fixture();
    let now = NOW;
    const fetchLiteLlm = vi.fn(async () => PRICES);
    const service = f.service({ fetchLiteLlm, now: () => now });
    expect(
      (await result(service, { kind: "week" }, "Asia/Shanghai", true)).estimatedCostUsd,
    ).toBeCloseTo(WEEK_COST, 12);

    // A day later LiteLLM doubles every price; the counted usage is not read again.
    fetchLiteLlm.mockResolvedValue(
      litellmPrices({ "claude-synthetic-1": [2, 4, 0.2, 2], "claude-synthetic-2": [4, 8, 0.4, 4] }),
    );
    now += 25 * 3_600_000;
    const custom = { kind: "custom", from: "2026-03-02", to: "2026-03-08" };
    // Expired prices answer at once while new ones load in the background.
    expect((await result(service, custom)).estimatedCostUsd).toBeCloseTo(WEEK_COST, 12);
    await vi.waitFor(async () => {
      expect((await result(service, custom)).estimatedCostUsd).toBeCloseTo(2 * WEEK_COST, 12);
    });
    expect(fetchLiteLlm).toHaveBeenCalledTimes(2);
    expect(f.read).toHaveBeenCalledOnce();
  });

  it("does not wait for LiteLLM once prices are loaded", async () => {
    const f = await fixture();
    let now = NOW;
    const fetchLiteLlm = vi.fn(async () => PRICES);
    const service = f.service({ fetchLiteLlm, now: () => now });
    await result(service, { kind: "week" }, "Asia/Shanghai", true);

    fetchLiteLlm.mockImplementation(() => new Promise(() => undefined));
    now += 25 * 3_600_000;
    const custom = { kind: "custom", from: "2026-03-02", to: "2026-03-08" };
    expect((await result(service, custom)).estimatedCostUsd).toBeCloseTo(WEEK_COST, 12);
    expect((await result(service, custom)).estimatedCostUsd).toBeCloseTo(WEEK_COST, 12);
    await vi.waitFor(() => expect(fetchLiteLlm).toHaveBeenCalledTimes(2));
    // One refresh at a time, even while it hangs.
    expect((await result(service, custom)).estimatedCostUsd).toBeCloseTo(WEEK_COST, 12);
    expect(fetchLiteLlm).toHaveBeenCalledTimes(2);
  });

  it("costs 0 for unpriced models and prefers a Harness's own reported cost", async () => {
    const f = await fixture();
    const record = (dedupeKey: string, model: string, reportedCostUsd?: number) => ({
      dedupeKey,
      occurredAt: Date.parse("2026-03-03T08:00:00.000Z"),
      nativeSessionId: "s",
      model,
      tokens: { input: 1_000_000, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
      conversations: 1,
      ...(reportedCostUsd === undefined ? {} : { reportedCostUsd }),
    });
    const pi = {
      harnessId: "pi",
      nativeUsage: {
        read: vi.fn(async () => ({
          ok: true,
          value: {
            records: [
              record("unknown", "house-model-without-price"),
              record("reported", "claude-synthetic-1", 0.25),
              // A subscription route reports zero; it is not priced at API rates.
              record("subscription", "claude-synthetic-2", 0),
            ],
            cursor: null,
          },
        })),
      },
    } as unknown as HarnessAdapter;

    const week = await result(f.service({ others: [["pi", pi]] }), { kind: "week" }, "UTC", true);

    expect(week.totals.total).toBe(229 + 3_000_000);
    expect(week.estimatedCostUsd).toBeCloseTo(
      (2 * 2 + 7 * 4 + 200 * 0.2 + 20 * 2) / 1e6 + 0.25,
      12,
    );
  });

  it("prices one-hour cache writes at their own rate and rebuilds totals saved without them", async () => {
    const f = await fixture();
    const written = (id: string, ephemeral5m: number, ephemeral1h: number) => {
      const line = response(id, "2026-03-03T08:00:00.000Z", {
        input: 0,
        cacheRead: 0,
        cacheWrite: ephemeral5m + ephemeral1h,
        output: 0,
      });
      return {
        ...line,
        message: {
          ...line.message,
          usage: {
            ...line.message.usage,
            cache_creation: {
              ephemeral_5m_input_tokens: ephemeral5m,
              ephemeral_1h_input_tokens: ephemeral1h,
            },
          },
        },
      };
    };
    await writeFile(
      f.mainFile,
      lines(written("c-1", 600_000, 400_000), written("c-2", 0, 1_000_000)),
    );
    // Totals saved before one-hour writes were counted separately.
    const usage = path.join(f.root, "data", "usage");
    await mkdir(usage, { recursive: true });
    await writeFile(
      path.join(usage, "local-usage.json"),
      JSON.stringify({ formatVersion: 1, sources: {}, buckets: [] }),
    );
    const diagnose = vi.fn();
    const claude = new ClaudeCodeAdapter({
      environment: { CLAUDE_CONFIG_DIR: path.join(f.root, "claude") },
    });
    cleanup.push(() => claude.close());
    const service = new LocalUsageService({
      adapters: new Map([["claude-code", claude]]),
      descriptors: () => [],
      directory: usage,
      fetchLiteLlm: async () => PRICES,
      diagnose,
      now: () => NOW,
    });

    const week = await result(service, { kind: "week" }, "UTC", true);

    // claude-synthetic-1: $1 per million five-minute writes, $1.6 per million one-hour writes.
    expect(week.estimatedCostUsd).toBeCloseTo(0.6 * 1 + 1.4 * 1.6, 9);
    // Cache write totals are unchanged by the split.
    expect(week.totals.cacheWrite).toBe(2_000_000);
    expect(diagnose).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("rebuilding") }),
    );
  });

  it("uses bundled prices when LiteLLM is unreachable", async () => {
    const f = await fixture();
    await writeFile(
      f.mainFile,
      lines(
        response(
          "msg-opus",
          "2026-03-02T10:00:00.000Z",
          {
            input: 1_000_000,
            cacheRead: 0,
            cacheWrite: 0,
            output: 1_000_000,
          },
          "claude-opus-5",
        ),
      ),
    );
    const offline = f.service({ fetchLiteLlm: () => Promise.reject(new Error("offline")) });

    const week = await result(offline, { kind: "week" }, "UTC", true);

    // Anthropic's published Opus 5 price: $5 / $25 per million tokens.
    expect(week.estimatedCostUsd).toBeCloseTo(30, 9);
  });

  it("adds official Codex rollouts as a Codex card without counting fork replays twice", async () => {
    const f = await fixture();
    const sessions = path.join(f.codexHome, "sessions", "2026", "03", "03");
    await mkdir(sessions, { recursive: true });
    const usage = (input: number, cached: number, output: number, reasoning: number) => ({
      input_tokens: input,
      cached_input_tokens: cached,
      output_tokens: output,
      reasoning_output_tokens: reasoning,
      total_tokens: input + output,
    });
    const meta = (id: string, timestamp: string, extra: Record<string, unknown> = {}) => ({
      timestamp,
      type: "session_meta",
      payload: { id, timestamp, cwd: "/work/codex", model_provider: "openai", ...extra },
    });
    const turnContext = (timestamp: string) => ({
      timestamp,
      type: "turn_context",
      payload: { cwd: "/work/codex", model: "gpt-synthetic-3" },
    });
    const tokenCount = (
      timestamp: string,
      total: ReturnType<typeof usage>,
      last: ReturnType<typeof usage>,
    ) => ({
      timestamp,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: total, last_token_usage: last },
      },
    });
    const parent = "44444444-4444-4444-8444-444444444444";
    const fork = "55555555-5555-4555-8555-555555555555";
    const parentLines = [
      meta(parent, "2026-03-03T08:00:00.000Z"),
      turnContext("2026-03-03T08:00:01.000Z"),
      tokenCount(
        "2026-03-03T08:00:05.000Z",
        usage(1_000, 600, 100, 40),
        usage(1_000, 600, 100, 40),
      ),
    ];
    await writeFile(
      path.join(sessions, `rollout-2026-03-03T08-00-00-${parent}.jsonl`),
      lines(...parentLines),
    );
    const forkFile = path.join(sessions, `rollout-2026-03-03T09-00-00-${fork}.jsonl`);
    await writeFile(
      forkFile,
      lines(
        meta(fork, "2026-03-03T09:00:00.000Z", { forked_from_id: parent }),
        ...parentLines.map((line) => ({ ...line, timestamp: "2026-03-03T09:00:00.001Z" })),
      ),
    );
    const service = f.service({ officialCodex: true });

    const first = await result(service, { kind: "week" }, "UTC", true);
    expect(first.harnesses).toEqual([
      {
        harnessId: "codex",
        name: "Codex",
        totalTokens: 1_100,
        models: 1,
        providers: [{ provider: "openai", totalTokens: 1_100, models: 1 }],
      },
      {
        harnessId: "claude-code",
        name: "Claude Code",
        totalTokens: 229,
        models: 1,
        providers: [],
      },
    ]);

    await appendFile(
      forkFile,
      lines(
        turnContext("2026-03-03T09:00:02.000Z"),
        tokenCount(
          "2026-03-03T09:00:05.000Z",
          usage(1_500, 1_000, 150, 60),
          usage(500, 400, 50, 20),
        ),
      ),
    );
    const week = await result(service, { kind: "week" }, "UTC", true);

    expect(week.harnesses[0]).toEqual({
      harnessId: "codex",
      name: "Codex",
      totalTokens: 1_100 + 550,
      models: 1,
      providers: [{ provider: "openai", totalTokens: 1_650, models: 1 }],
    });
    expect(week.models).toBe(2);
    expect(week.totals).toEqual({
      total: 229 + 1_650,
      input: 2 + 400 + 100,
      cacheRead: 200 + 600 + 400,
      cacheWrite: 20,
      output: 7 + 100 + 50,
      // Codex reasoning is part of its output and is neither shown nor priced again.
      reasoning: 0,
      conversations: 1 + 2,
    });
    expect(week.daily).toEqual([
      {
        date: "2026-03-03",
        total: 1_650,
        input: 500,
        output: 150,
        cacheRead: 1_000,
        reasoning: 0,
        conversations: 2,
      },
      {
        date: "2026-03-02",
        total: 229,
        input: 2,
        output: 7,
        cacheRead: 200,
        reasoning: 0,
        conversations: 1,
      },
    ]);
    const codexCost = (400 * 1 + 600 * 0.1 + 100 * 10 + (100 * 1 + 400 * 0.1 + 50 * 10)) / 1e6;
    const claudeCost = (2 * 2 + 7 * 4 + 200 * 0.2 + 20 * 2) / 1e6;
    expect(week.estimatedCostUsd).toBeCloseTo(codexCost + claudeCost, 12);
  });

  it("adds native Pi usage as a Pi card broken down by Provider", async () => {
    const f = await fixture();
    const agent = path.join(f.root, "pi");
    const project = path.join(agent, "sessions", "--work-pi--");
    await mkdir(project, { recursive: true });
    const header = (id: string) => ({
      type: "session",
      version: 3,
      id,
      timestamp: "2026-03-03T07:59:00.000Z",
      cwd: "/work/pi",
    });
    const reply = (
      id: string,
      timestamp: string,
      provider: string,
      model: string,
      usage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        reasoning: number;
      },
    ) => ({
      type: "message",
      id,
      parentId: null,
      timestamp,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "synthetic answer" }],
        provider,
        model,
        usage: {
          ...usage,
          totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
      },
    });
    const main = reply("a-1", "2026-03-03T08:00:00.000Z", "openai-codex", "gpt-synthetic-3", {
      input: 1_000,
      output: 400,
      cacheRead: 5_000,
      cacheWrite: 0,
      reasoning: 100,
    });
    const file = path.join(project, "pi-session-1.jsonl");
    await writeFile(
      file,
      lines(
        header("pi-session-1"),
        main,
        reply("a-2", "2026-03-03T08:01:00.000Z", "anthropic", "claude-synthetic-1", {
          input: 10,
          output: 20,
          cacheRead: 30,
          cacheWrite: 40,
          reasoning: 0,
        }),
      ),
    );
    // A fork copies the original entry; only its own reply is new.
    await writeFile(path.join(project, "pi-session-2.jsonl"), lines(header("pi-session-2"), main));
    const pi = new PiAdapter({ environment: { PI_CODING_AGENT_DIR: agent } });
    cleanup.push(() => pi.close());
    const service = f.service({
      others: [["pi", pi]],
      names: () => ({ "claude-code": "Claude Code", pi: "Pi" }),
    });

    const first = await result(service, { kind: "week" }, "UTC", true);
    expect(first.harnesses[0]).toEqual({
      harnessId: "pi",
      name: "Pi",
      totalTokens: 6_400 + 100,
      models: 2,
      providers: [
        { provider: "openai-codex", totalTokens: 6_400, models: 1 },
        { provider: "anthropic", totalTokens: 100, models: 1 },
      ],
    });

    await appendFile(
      file,
      lines(
        reply("a-3", "2026-03-03T09:00:00.000Z", "anthropic", "claude-synthetic-1", {
          input: 1,
          output: 2,
          cacheRead: 3,
          cacheWrite: 4,
          reasoning: 0,
        }),
      ),
    );
    const week = await result(service, { kind: "week" }, "UTC", true);
    expect(week.harnesses[0]?.providers).toEqual([
      { provider: "openai-codex", totalTokens: 6_400, models: 1 },
      { provider: "anthropic", totalTokens: 110, models: 1 },
    ]);
    const piDay = week.daily.find((day) => day.date === "2026-03-03");
    // Pi's reasoning is split out of its output; each assistant message is one conversation.
    expect(piDay).toEqual({
      date: "2026-03-03",
      total: 6_510,
      input: 1_011,
      output: 300 + 22,
      cacheRead: 5_033,
      reasoning: 100,
      conversations: 3,
    });
    const piCost =
      (1_000 * 1 + 5_000 * 0.1 + 400 * 10 + (11 * 1 + 22 * 2 + 33 * 0.1 + 44 * 1)) / 1e6;
    const claudeCost = (2 * 2 + 7 * 4 + 200 * 0.2 + 20 * 2) / 1e6;
    expect(week.estimatedCostUsd).toBeCloseTo(piCost + claudeCost, 12);
  });

  it("adds native oh-my-pi usage, subagent sessions included, as a card broken down by Provider", async () => {
    const f = await fixture();
    const agent = path.join(f.root, "omp");
    const project = path.join(agent, "sessions", "-work-omp");
    const stem = "2026-03-03T07-59-00-000Z_omp-session-1";
    await mkdir(path.join(project, stem), { recursive: true });
    const title = { type: "title", v: 1, title: "synthetic", updatedAt: "", pad: " " };
    const header = (id: string) => ({
      type: "session",
      version: 3,
      id,
      timestamp: "2026-03-03T07:59:00.000Z",
      cwd: "/work/omp",
    });
    const reply = (
      id: string,
      timestamp: string,
      provider: string,
      model: string,
      usage: { input: number; output: number; cacheRead: number; cacheWrite: number },
      extra: { reasoningTokens?: number; cost?: number } = {},
    ) => ({
      type: "message",
      id,
      parentId: null,
      timestamp,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "synthetic answer" }],
        provider,
        model,
        usage: {
          ...usage,
          ...(extra.reasoningTokens ? { reasoningTokens: extra.reasoningTokens } : {}),
          totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: extra.cost ?? 0 },
        },
        stopReason: "stop",
      },
    });
    const main = reply(
      "a-1",
      "2026-03-03T08:00:00.000Z",
      "openai-codex",
      "gpt-synthetic-3",
      { input: 1_000, output: 400, cacheRead: 5_000, cacheWrite: 0 },
      { reasoningTokens: 100 },
    );
    await writeFile(
      path.join(project, `${stem}.jsonl`),
      lines(
        title,
        header("omp-session-1"),
        main,
        reply(
          "a-2",
          "2026-03-03T08:01:00.000Z",
          "Anthropic",
          "claude-synthetic-1",
          { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
          { cost: 0.5 },
        ),
      ),
    );
    // A fork copies the original entry; it is counted once.
    await writeFile(
      path.join(project, "2026-03-03T09-00-00-000Z_omp-session-2.jsonl"),
      lines(title, header("omp-session-2"), main),
    );
    const subagent = path.join(project, stem, "Reviewer.jsonl");
    await writeFile(
      subagent,
      lines(
        title,
        header("omp-subagent-1"),
        reply("c-1", "2026-03-03T08:02:00.000Z", "openai-codex", "gpt-synthetic-3", {
          input: 100,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
        }),
      ),
    );
    const omp = new OmpAdapter({ environment: { PI_CODING_AGENT_DIR: agent } });
    cleanup.push(() => omp.close());
    const service = f.service({
      others: [["omp", omp]],
      names: () => ({ "claude-code": "Claude Code", omp: "oh-my-pi" }),
    });

    const first = await result(service, { kind: "week" }, "UTC", true);
    expect(first.harnesses[0]).toEqual({
      harnessId: "omp",
      name: "oh-my-pi",
      totalTokens: 6_550 + 100,
      models: 2,
      providers: [
        { provider: "openai-codex", totalTokens: 6_550, models: 1 },
        { provider: "Anthropic", totalTokens: 100, models: 1 },
      ],
    });

    await appendFile(
      subagent,
      lines(
        reply("c-2", "2026-03-03T09:00:00.000Z", "openai-codex", "gpt-synthetic-3", {
          input: 1,
          output: 2,
          cacheRead: 3,
          cacheWrite: 4,
        }),
      ),
    );
    const week = await result(service, { kind: "week" }, "UTC", true);
    const ompDay = week.daily.find((day) => day.date === "2026-03-03");
    // Reasoning tokens are split out of OMP's output; each assistant message is one conversation.
    expect(ompDay).toEqual({
      date: "2026-03-03",
      total: 6_660,
      input: 1_111,
      output: 300 + 20 + 50 + 2,
      cacheRead: 5_033,
      reasoning: 100,
      conversations: 4,
    });
    // The Anthropic reply carries OMP's own cost; the others are priced from LiteLLM.
    const ompCost =
      0.5 + (1_000 * 1 + 5_000 * 0.1 + 400 * 10 + (101 * 1 + 52 * 10 + 3 * 0.1)) / 1e6;
    const claudeCost = (2 * 2 + 7 * 4 + 200 * 0.2 + 20 * 2) / 1e6;
    expect(week.estimatedCostUsd).toBeCloseTo(ompCost + claudeCost, 12);
  });

  it("reports rolling 7- and 30-day totals, the active-day average and usage history", async () => {
    const f = await fixture();
    const output = (tokens: number) => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: tokens });
    // In Shanghai today is 2026-03-04, so 7 days start 02-26 and 30 days start 02-03.
    await writeFile(
      path.join(f.project, "33333333-3333-4333-8333-333333333333.jsonl"),
      lines(
        response("msg-7d-first", "2026-02-25T16:00:00.000Z", output(10)),
        response("msg-7d-before", "2026-02-25T15:59:00.000Z", output(100)),
        response("msg-30d-first", "2026-02-02T16:00:00.000Z", output(1_000)),
        response("msg-30d-before", "2026-02-02T15:59:00.000Z", output(10_000)),
        // Older than the 24-month "total" period, still the first day of use.
        response("msg-first", "2024-01-15T12:00:00.000Z", output(100_000)),
        // A day with conversations but no tokens is not an active day.
        prompt("u-only", "2026-03-03T08:00:00.000Z"),
        // A clock-skewed record after today counts in no stat block.
        response("msg-tomorrow", "2026-03-05T12:00:00.000Z", output(1_000_000)),
      ),
    );
    const service = f.service();

    const stats = {
      last7Days: 345 + 1_000_004 + 10,
      last30Days: 345 + 1_000_004 + 10 + 100 + 1_000,
      // 02-03, 02-25, 02-26, 02-27 and 03-02 have tokens in the last 30 days.
      dailyAverage: Math.round((345 + 1_000_004 + 10 + 100 + 1_000) / 5),
      activeDays: 7,
      firstActiveDate: "2024-01-15",
    };
    const week = await result(service, { kind: "week" }, "Asia/Shanghai", true);
    expect(week.stats).toEqual(stats);
    expect(week.totals.conversations).toBe(3);
    // Stat blocks do not depend on the selected period; conversations do.
    const day = await result(service, { kind: "day" });
    expect(day.stats).toEqual(stats);
    expect(day.totals.conversations).toBe(0);
    expect((await result(service, { kind: "total" })).stats).toEqual(stats);
  });

  it("reports empty stat blocks without usage and exact ones for a single day", async () => {
    const f = await fixture();
    await writeFile(f.mainFile, "");
    const empty = await result(f.service(), { kind: "week" }, "Asia/Shanghai", true);
    expect(empty.stats).toEqual({
      last7Days: 0,
      last30Days: 0,
      dailyAverage: 0,
      activeDays: 0,
      firstActiveDate: null,
    });

    const oneDay = await fixture();
    await writeFile(oneDay.mainFile, lines(prompt("u-2", "2026-03-02T09:59:00.000Z"), MONDAY));
    const single = await result(oneDay.service(), { kind: "day" }, "Asia/Shanghai", true);
    expect(single.stats).toEqual({
      last7Days: 229,
      last30Days: 229,
      dailyAverage: 229,
      activeDays: 1,
      firstActiveDate: "2026-03-02",
    });
  });

  it("groups usage by Git remote owner/repo, otherwise by folder name", async () => {
    const f = await fixture();
    const repos = path.join(f.root, "repos");
    const widget = path.join(repos, "widget");
    await mkdir(path.join(widget, "src"), { recursive: true });
    await mkdir(path.join(widget, ".git", "worktrees", "wt"), { recursive: true });
    await writeFile(
      path.join(widget, ".git", "config"),
      [
        "[core]",
        "\tbare = false",
        '[remote "upstream"]',
        "\turl = https://github.com/someone-else/widget.git",
        '[remote "origin"]',
        "\turl = git@github.com:acme/widget.git",
        "\tfetch = +refs/heads/*:refs/remotes/origin/*",
        "",
      ].join("\n"),
    );
    // A linked worktree shares the main repository's remotes.
    await writeFile(path.join(widget, ".git", "worktrees", "wt", "commondir"), "../..\n");
    const worktree = path.join(repos, "widget-wt");
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(worktree, ".git"), "gitdir: ../widget/.git/worktrees/wt\n");
    const local = path.join(repos, "local-only");
    await mkdir(path.join(local, ".git"), { recursive: true });
    await writeFile(path.join(local, ".git", "config"), "[core]\n\tbare = false\n");
    await mkdir(path.join(local, "nested"), { recursive: true });
    // A worktree of a repository without remotes is named after the main repository.
    await mkdir(path.join(local, ".git", "worktrees", "feature"), { recursive: true });
    await writeFile(path.join(local, ".git", "worktrees", "feature", "commondir"), "../..\n");
    const localWorktree = path.join(repos, "local-only-feature");
    await mkdir(localWorktree, { recursive: true });
    await writeFile(
      path.join(localWorktree, ".git"),
      `gitdir: ${path.join(local, ".git", "worktrees", "feature")}\n`,
    );
    const scratch = path.join(f.root, "scratch");
    await mkdir(scratch, { recursive: true });
    // Without an `origin`, the first remote names the project as its last two path segments.
    const tool = path.join(repos, "tool");
    await mkdir(path.join(tool, ".git"), { recursive: true });
    await writeFile(
      path.join(tool, ".git", "config"),
      '[remote "mirror"]\n\turl = https://gitlab.example.com/group/sub/tool.git/\n',
    );

    const at = (cwd: string, id: string, output: number) => ({
      ...response(id, "2026-03-03T08:00:00.000Z", {
        input: 0,
        cacheRead: 0,
        cacheWrite: 0,
        output,
      }),
      cwd,
    });
    await appendFile(
      f.mainFile,
      lines(
        at(path.join(widget, "src"), "p-1", 1_000),
        at(worktree, "p-2", 500),
        at(path.join(local, "nested"), "p-3", 300),
        at(scratch, "p-4", 200),
        at(tool, "p-5", 100),
        at(localWorktree, "p-6", 40),
      ),
    );
    const pi = {
      harnessId: "pi",
      nativeUsage: {
        read: vi.fn(async () => ({
          ok: true,
          value: {
            records: [
              {
                dedupeKey: "pi-1",
                occurredAt: Date.parse("2026-03-03T09:00:00.000Z"),
                nativeSessionId: "s",
                model: "gpt-synthetic-3",
                cwd: scratch,
                tokens: { input: 5_000, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
                conversations: 1,
              },
              {
                // An empty working directory is no working directory.
                dedupeKey: "pi-3",
                occurredAt: Date.parse("2026-03-03T09:00:00.000Z"),
                nativeSessionId: "s",
                model: "gpt-synthetic-3",
                cwd: "",
                tokens: { input: 8, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
                conversations: 1,
              },
              {
                // Usage without a working directory belongs to no project.
                dedupeKey: "pi-2",
                occurredAt: Date.parse("2026-03-03T09:00:00.000Z"),
                nativeSessionId: "s",
                model: "gpt-synthetic-3",
                tokens: { input: 70, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
                conversations: 1,
              },
            ],
            cursor: null,
          },
        })),
      },
    } as unknown as HarnessAdapter;
    const service = f.service({
      others: [["pi", pi]],
      names: () => ({ "claude-code": "Claude Code", pi: "Pi" }),
    });

    const week = await result(service, { kind: "week" }, "UTC", true);

    expect(week.projects).toEqual([
      { project: "scratch", totalTokens: 5_200, harnessIds: ["pi", "claude-code"] },
      { project: "acme/widget", totalTokens: 1_500, harnessIds: ["claude-code"] },
      { project: "local-only", totalTokens: 340, harnessIds: ["claude-code"] },
      { project: "project", totalTokens: 229, harnessIds: ["claude-code"] },
      { project: "sub/tool", totalTokens: 100, harnessIds: ["claude-code"] },
    ]);
    expect(week.totals.total).toBe(229 + 2_140 + 5_078);
    // Projects follow the selected range.
    expect((await result(service, { kind: "day" }, "UTC")).projects).toEqual([]);
  });

  it("adds only new records on refresh and never double counts copies or restarts", async () => {
    const f = await fixture();
    const first = await result(f.service(), { kind: "total" }, "UTC", true);

    await appendFile(
      f.mainFile,
      lines(
        prompt("u-3", "2026-03-03T08:00:00.000Z"),
        response("msg-d", "2026-03-03T08:00:01.000Z", {
          input: 1,
          cacheRead: 0,
          cacheWrite: 0,
          output: 1,
        }),
      ),
    );
    // A resumed or forked transcript copies earlier lines into another file.
    await writeFile(
      path.join(f.project, "22222222-2222-4222-8222-222222222222.jsonl"),
      lines(prompt("u-1", "2026-03-01T23:29:00.000Z"), MONDAY),
    );
    const service = f.service();
    const cached = await result(service, { kind: "total" }, "UTC", false);
    expect(cached.totals).toEqual(first.totals);

    const refreshed = await result(service, { kind: "total" }, "UTC", true);
    expect(refreshed.totals.total).toBe(first.totals.total + 2);
    expect(refreshed.totals.conversations).toBe(first.totals.conversations + 1);

    const restarted = await result(f.service(), { kind: "total" }, "UTC", true);
    expect(restarted.totals).toEqual(refreshed.totals);
    expect(restarted.daily).toEqual(refreshed.daily);
  });

  it("answers a period switch during a refresh with the refreshed totals", async () => {
    const f = await fixture();
    const first = await result(f.service(), { kind: "total" }, "UTC", true);
    await appendFile(
      f.mainFile,
      lines(
        response("msg-d", "2026-03-03T08:00:01.000Z", {
          input: 1,
          cacheRead: 0,
          cacheWrite: 0,
          output: 1,
        }),
      ),
    );
    const service = f.service();
    const [refreshing, switched] = await Promise.all([
      result(service, { kind: "total" }, "UTC", true),
      result(service, { kind: "total" }, "UTC", false),
    ]);
    expect(refreshing.totals.total).toBe(first.totals.total + 2);
    expect(switched.totals).toEqual(refreshing.totals);
  });

  it("isolates a Harness whose records are malformed and keeps counting the others", async () => {
    const f = await fixture();
    const record = {
      dedupeKey: "k",
      occurredAt: Date.parse("2026-03-03T08:00:00.000Z"),
      nativeSessionId: "s",
      tokens: { input: 1, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
      conversations: 0,
      // Message text never belongs in a usage record.
      text: "synthetic message",
    };
    const leaking = {
      harnessId: "pi",
      nativeUsage: {
        read: vi.fn(async () => ({ ok: true, value: { records: [record], cursor: null } })),
      },
    } as unknown as HarnessAdapter;
    const week = await result(
      f.service({ others: [["pi", leaking]], names: () => ({ "claude-code": "Claude Code" }) }),
      { kind: "week" },
      "UTC",
      true,
    );
    expect(week.totals.total).toBe(229);
    expect(week.harnesses.map((harness) => harness.harnessId)).toEqual(["claude-code"]);
    expect(week.failures).toEqual([{ harnessId: "pi", name: "pi" }]);
  });

  it("reports a Harness whose read fails and keeps its last totals until it reads again", async () => {
    const f = await fixture();
    let available = true;
    const pi = {
      harnessId: "pi",
      nativeUsage: {
        read: vi.fn(async (cursor: JsonValue | null) => {
          if (!available) {
            return {
              ok: false,
              error: { code: "unavailable", message: "Pi records are unreadable", retryable: true },
            };
          }
          return {
            ok: true,
            value: {
              records:
                cursor === null
                  ? [
                      {
                        dedupeKey: "pi-1",
                        occurredAt: Date.parse("2026-03-03T08:00:00.000Z"),
                        nativeSessionId: "s",
                        model: "gpt-synthetic-3",
                        tokens: { input: 50, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
                        conversations: 1,
                      },
                    ]
                  : [],
              cursor: "read",
            },
          };
        }),
      },
    } as unknown as HarnessAdapter;
    const service = f.service({
      others: [["pi", pi]],
      names: () => ({ "claude-code": "Claude Code", pi: "Pi" }),
    });
    const first = await result(service, { kind: "week" }, "UTC", true);
    expect(first.failures).toEqual([]);

    available = false;
    await appendFile(
      f.mainFile,
      lines(
        response("msg-d", "2026-03-03T08:00:01.000Z", {
          input: 1,
          cacheRead: 0,
          cacheWrite: 0,
          output: 1,
        }),
      ),
    );
    const failing = await result(service, { kind: "week" }, "UTC", true);
    expect(failing.failures).toEqual([{ harnessId: "pi", name: "Pi" }]);
    // Pi keeps its earlier totals while Claude Code still advances.
    expect(failing.harnesses.map(({ harnessId, totalTokens }) => [harnessId, totalTokens])).toEqual(
      [
        ["claude-code", 231],
        ["pi", 50],
      ],
    );
    // A period switch answers from the same read and still shows the failure.
    expect((await result(service, { kind: "day" }, "UTC")).failures).toHaveLength(1);

    available = true;
    const recovered = await result(service, { kind: "week" }, "UTC", true);
    expect(recovered.failures).toEqual([]);
    expect(recovered.totals.total).toBe(231 + 50);
  });

  it("answers with read progress while a read is running and the totals once it is done", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = await fixture();
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const slow = {
      harnessId: "pi",
      nativeUsage: {
        read: vi.fn(
          async (_cursor: JsonValue | null, onProgress?: (progress: Progress) => void) => {
            onProgress?.({ processed: 2, total: 5 });
            // Nonsense progress from a plugin is ignored.
            onProgress?.({ processed: 9, total: 5 });
            await finished;
            return { ok: true, value: { records: [], cursor: null } };
          },
        ),
      },
    } as unknown as HarnessAdapter;
    const service = f.service({ others: [["pi", slow]] });
    const poll = (refresh: boolean) =>
      query(service, { period: { kind: "week" }, timeZone: "UTC", refresh });

    const opening = poll(true);
    await vi.waitFor(() => expect(slow.nativeUsage?.read).toHaveBeenCalledOnce());
    await f.read.mock.results[0]?.value;
    // A query waits half a second for the read before answering with its progress.
    await vi.advanceTimersByTimeAsync(499);
    await vi.advanceTimersByTimeAsync(1);
    // The real Claude Code Adapter has read its one file; the slow source is at 2 of 5.
    expect((await opening).result).toEqual({
      status: "reading",
      progress: { processed: 3, total: 6 },
    });
    // Polling without refresh joins the same read.
    const polling = poll(false);
    await vi.advanceTimersByTimeAsync(500);
    expect((await polling).result).toEqual({
      status: "reading",
      progress: { processed: 3, total: 6 },
    });

    finish();
    const done = localUsageQueryResultSchema.parse((await poll(false)).result);
    expect(done).toMatchObject({ status: "ready", totals: { total: 229 } });
    expect(f.read).toHaveBeenCalledOnce();
  });

  // A read-only directory is not read-only for root, and Windows ignores the mode.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports a read that failed after its query stopped waiting instead of reading again",
    async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const f = await fixture();
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const slow = {
        harnessId: "pi",
        nativeUsage: {
          read: vi
            .fn()
            .mockImplementationOnce(async () => {
              await finished;
              return { ok: true, value: { records: [], cursor: null } };
            })
            // A second read would never finish, so polling would only ever see progress.
            .mockImplementation(() => new Promise(() => undefined)),
        },
      } as unknown as HarnessAdapter;
      const service = f.service({ others: [["pi", slow]] });
      const poll = async (refresh: boolean) => {
        const answer = query(service, { period: { kind: "week" }, timeZone: "UTC", refresh });
        await vi.advanceTimersByTimeAsync(500);
        return answer;
      };
      expect((await poll(true)).result).toMatchObject({ status: "reading" });

      // Saving the totals fails once the read finishes.
      const usage = path.join(f.root, "data", "usage");
      await mkdir(usage, { recursive: true });
      await chmod(usage, 0o500);
      cleanup.push(() => chmod(usage, 0o700));
      finish();
      await vi.waitFor(async () =>
        expect(await poll(false)).toMatchObject({ error: { code: -32082 } }),
      );
      expect(slow.nativeUsage?.read).toHaveBeenCalledOnce();
    },
  );

  it("replies with an error when the view cannot be built", async () => {
    const f = await fixture();
    const service = f.service({ names: () => ({ "claude-code": "x".repeat(129) }) });
    expect(
      await query(service, { period: { kind: "week" }, timeZone: "UTC", refresh: true }),
    ).toMatchObject({ error: { code: -32082 } });
  });

  it("shares one native read between concurrent requests", async () => {
    const f = await fixture();
    const service = f.service();
    const [a, b] = await Promise.all([
      result(service, { kind: "week" }, "UTC", true),
      result(service, { kind: "day" }, "UTC", true),
    ]);
    expect(a.totals.total).toBe(229);
    expect(b.totals.total).toBe(0);
    expect(f.read).toHaveBeenCalledOnce();
  });

  it("rejects invalid params before reading native records", async () => {
    const f = await fixture();
    const service = f.service();
    for (const params of [
      { period: { kind: "week" }, timeZone: "Mars/Olympus", refresh: true },
      {
        period: { kind: "custom", from: "2026-03-02", to: "2026-03-01" },
        timeZone: "UTC",
        refresh: true,
      },
      { period: { kind: "week" }, timeZone: "UTC" },
    ]) {
      expect(await query(service, params)).toMatchObject({ error: { code: -32602 } });
    }
    expect(f.read).not.toHaveBeenCalled();
  });
});
