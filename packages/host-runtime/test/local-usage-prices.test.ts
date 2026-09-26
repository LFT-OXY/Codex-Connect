import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadModelPrices, parseLiteLlmPrices } from "../src/local-usage-prices.js";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-03-04T12:00:00.000Z");

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function directory(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "codexhost-model-prices-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return path.join(root, "usage");
}

function litellm(inputPerToken: number) {
  return {
    sample_spec: { input_cost_per_token: 0, output_cost_per_token: 0 },
    "Remote-Model-1": {
      mode: "chat",
      input_cost_per_token: inputPerToken,
      output_cost_per_token: 2e-6,
      cache_read_input_token_cost: 1e-7,
      cache_creation_input_token_cost: 1.25e-6,
    },
  };
}

async function writeCache(dir: string, fetchedAt: number, inputPerToken: number) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "model-prices.json"),
    JSON.stringify({
      formatVersion: 1,
      fetchedAt,
      prices: { "remote-model-1": [inputPerToken, 2e-6, 1e-7, 1.25e-6] },
    }),
  );
}

function load(dir: string, fetchLiteLlm: () => Promise<unknown>, diagnose = vi.fn()) {
  return loadModelPrices({ directory: dir, now: NOW, fetchLiteLlm, diagnose });
}

describe("LiteLLM price parsing", () => {
  it("keeps priced text models by lowercase name and prices missing cache kinds at 0", () => {
    const prices = parseLiteLlmPrices({
      sample_spec: { input_cost_per_token: 0, output_cost_per_token: 0 },
      "Model-A": { mode: "chat", input_cost_per_token: 1e-6, output_cost_per_token: 3e-6 },
      "model-b": { output_cost_per_token: 4e-6 },
      "embed-1": { mode: "embedding", input_cost_per_token: 1e-8 },
      "free-text": { mode: "responses" },
      "bad-1": { mode: "chat", input_cost_per_token: -1, output_cost_per_token: "2" },
      broken: "not an entry",
    });
    expect([...prices]).toEqual([
      ["model-a", { input: 1e-6, output: 3e-6, cacheRead: 0, cacheWrite: 0 }],
      ["model-b", { input: 0, output: 4e-6, cacheRead: 0, cacheWrite: 0 }],
    ]);
  });
});

describe("model price sources", () => {
  it("uses a disk cache younger than 24 hours without fetching", async () => {
    const dir = await directory();
    await writeCache(dir, NOW - 22 * HOUR, 3e-6);
    const fetchLiteLlm = vi.fn(async () => litellm(9e-6));

    const loaded = await load(dir, fetchLiteLlm);

    expect(fetchLiteLlm).not.toHaveBeenCalled();
    expect(loaded.prices.get("remote-model-1")?.input).toBe(3e-6);
    expect(loaded.refreshAfter).toBe(NOW + 2 * HOUR);
  });

  it("fetches LiteLLM when the cache is stale and caches the result", async () => {
    const dir = await directory();
    await writeCache(dir, NOW - 25 * HOUR, 3e-6);

    const loaded = await load(dir, async () => litellm(9e-6));

    expect(loaded.prices.get("remote-model-1")).toEqual({
      input: 9e-6,
      output: 2e-6,
      cacheRead: 1e-7,
      cacheWrite: 1.25e-6,
    });
    expect(loaded.refreshAfter).toBe(NOW + 24 * HOUR);
    const cached = JSON.parse(await readFile(path.join(dir, "model-prices.json"), "utf8"));
    expect(cached).toMatchObject({ formatVersion: 1, fetchedAt: NOW });
    const offline = await load(dir, () => Promise.reject(new Error("offline")));
    expect(offline.prices.get("remote-model-1")?.input).toBe(9e-6);
  });

  it("falls back to a stale cache when LiteLLM cannot be fetched", async () => {
    const dir = await directory();
    await writeCache(dir, NOW - 25 * HOUR, 3e-6);
    const diagnose = vi.fn();

    const loaded = await load(dir, () => Promise.reject(new Error("offline")), diagnose);

    expect(loaded.prices.get("remote-model-1")?.input).toBe(3e-6);
    // Offline tables are retried within the hour rather than kept for a day.
    expect(loaded.refreshAfter).toBe(NOW + HOUR);
    expect(diagnose).toHaveBeenCalled();
  });

  it("falls back to the bundled snapshot without a cache or network", async () => {
    const dir = await directory();

    const loaded = await load(dir, () => Promise.reject(new Error("offline")));

    expect(loaded.prices.has("remote-model-1")).toBe(false);
    // Anthropic's published Opus 5 price: $5 / $25 per million tokens.
    expect(loaded.prices.get("claude-opus-5")).toMatchObject({ input: 5e-6, output: 25e-6 });
    expect(loaded.refreshAfter).toBe(NOW + HOUR);
  });

  it("treats a response without priced models as a failed fetch", async () => {
    const dir = await directory();
    await writeCache(dir, NOW - 25 * HOUR, 3e-6);

    const loaded = await load(dir, async () => ({ error: "rate limited" }));

    expect(loaded.prices.get("remote-model-1")?.input).toBe(3e-6);
  });

  it("ignores a damaged cache", async () => {
    const dir = await directory();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "model-prices.json"), "{not json");
    const diagnose = vi.fn();

    const loaded = await load(dir, async () => litellm(9e-6), diagnose);

    expect(loaded.prices.get("remote-model-1")?.input).toBe(9e-6);
    expect(diagnose).toHaveBeenCalled();
  });
});
