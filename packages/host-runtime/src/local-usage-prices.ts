import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { LITELLM_PRICE_SNAPSHOT } from "./local-usage-price-snapshot.js";
import type { ModelPrice, ModelPriceTable } from "./local-usage-pricing.js";
import { writeUsageFile } from "./local-usage-store.js";

export const LITELLM_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const FRESH_MS = 24 * 3_600_000;
/** An offline fallback is retried after an hour rather than kept for a day. */
const RETRY_MS = 3_600_000;
const FETCH_TIMEOUT_MS = 10_000;
// Modes whose usage is text tokens; image, audio and embedding prices never apply to a Harness.
const TEXT_MODES = new Set([undefined, "chat", "responses", "completion"]);

const priceSchema = z.number().nonnegative().finite();
/** `[input, output, cacheRead, cacheWrite, cacheWrite1h]`, USD per token. */
const priceTupleSchema = z.tuple([priceSchema, priceSchema, priceSchema, priceSchema, priceSchema]);
const priceRecordSchema = z.strictObject({
  // Version 1 had no one-hour cache write price; such a cache is ignored and refetched.
  formatVersion: z.literal(2),
  fetchedAt: z.number().int().nonnegative().safe(),
  prices: z.record(z.string(), priceTupleSchema),
});

/** Cache file and bundled snapshot share one shape. */
export type ModelPriceRecord = z.infer<typeof priceRecordSchema>;

export interface LoadedModelPrices {
  prices: ModelPriceTable;
  /** Epoch ms after which the sources are consulted again. */
  refreshAfter: number;
}

const litellmEntrySchema = z.object({
  mode: z.string().optional(),
  input_cost_per_token: priceSchema.optional(),
  output_cost_per_token: priceSchema.optional(),
  cache_read_input_token_cost: priceSchema.optional(),
  cache_creation_input_token_cost: priceSchema.optional(),
  cache_creation_input_token_cost_above_1hr: priceSchema.optional(),
});

/** Priced text models of LiteLLM's public table, keyed by lowercase name. */
export function parseLiteLlmPrices(raw: unknown): Map<string, ModelPrice> {
  const prices = new Map<string, ModelPrice>();
  if (!raw || typeof raw !== "object") return prices;
  for (const [name, value] of Object.entries(raw)) {
    if (name === "sample_spec") continue;
    const entry = litellmEntrySchema.safeParse(value);
    if (!entry.success || !TEXT_MODES.has(entry.data.mode)) continue;
    const { data } = entry;
    if (data.input_cost_per_token === undefined && data.output_cost_per_token === undefined) {
      continue;
    }
    const key = name.toLowerCase();
    if (prices.has(key)) continue;
    const cacheWrite = data.cache_creation_input_token_cost ?? 0;
    prices.set(key, {
      input: data.input_cost_per_token ?? 0,
      output: data.output_cost_per_token ?? 0,
      cacheRead: data.cache_read_input_token_cost ?? 0,
      cacheWrite,
      // A one-hour write costs at least a five-minute write.
      cacheWrite1h: data.cache_creation_input_token_cost_above_1hr ?? cacheWrite,
    });
  }
  return prices;
}

export function modelPriceRecord(
  prices: ReadonlyMap<string, ModelPrice>,
  fetchedAt: number,
): ModelPriceRecord {
  return {
    formatVersion: 2,
    fetchedAt,
    prices: Object.fromEntries(
      [...prices].map(([name, price]) => [
        name,
        [price.input, price.output, price.cacheRead, price.cacheWrite, price.cacheWrite1h],
      ]),
    ),
  };
}

function priceTable(record: ModelPriceRecord): ModelPriceTable {
  return new Map(
    Object.entries(record.prices).map(
      ([name, [input, output, cacheRead, cacheWrite, cacheWrite1h]]) => [
        name,
        { input, output, cacheRead, cacheWrite, cacheWrite1h },
      ],
    ),
  );
}

export async function fetchLiteLlmPrices(): Promise<unknown> {
  const response = await fetch(LITELLM_PRICES_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`LiteLLM prices request failed with HTTP ${response.status}`);
  return response.json();
}

async function readCache(
  file: string,
  diagnose: (error: unknown) => void,
): Promise<ModelPriceRecord | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      diagnose(error);
    }
    return null;
  }
  try {
    return priceRecordSchema.parse(JSON.parse(raw));
  } catch {
    diagnose(new Error("Model price cache is unreadable; ignoring it"));
    return null;
  }
}

/**
 * Model prices from, in order: a disk cache younger than 24 hours, LiteLLM's public table,
 * the stale cache, and the snapshot bundled with this release. Never fails.
 */
export async function loadModelPrices(input: {
  directory: string;
  now: number;
  fetchLiteLlm: () => Promise<unknown>;
  diagnose: (error: unknown) => void;
}): Promise<LoadedModelPrices> {
  const file = path.join(input.directory, "model-prices.json");
  const cached = await readCache(file, input.diagnose);
  if (cached && input.now - cached.fetchedAt < FRESH_MS) {
    return { prices: priceTable(cached), refreshAfter: cached.fetchedAt + FRESH_MS };
  }
  try {
    const prices = parseLiteLlmPrices(await input.fetchLiteLlm());
    if (prices.size === 0) throw new Error("LiteLLM prices contain no priced models");
    try {
      await writeUsageFile(file, modelPriceRecord(prices, input.now));
    } catch (error) {
      input.diagnose(error);
    }
    return { prices, refreshAfter: input.now + FRESH_MS };
  } catch (error) {
    input.diagnose(error);
  }
  return {
    prices: priceTable(cached ?? LITELLM_PRICE_SNAPSHOT),
    refreshAfter: input.now + RETRY_MS,
  };
}
