import type { HarnessAdapter } from "@codexhost/harness-adapter";
import {
  jsonValueSchema,
  localUsageQueryParamsSchema,
  localUsageQueryResultSchema,
  type HarnessPluginDescriptor,
  type JsonObject,
  type JsonRpcRequest,
} from "@codexhost/shared-contracts";

import {
  applyNativeUsageBatch,
  emptyLocalUsageState,
  loadLocalUsageState,
  saveLocalUsageState,
  type LocalUsageState,
} from "./local-usage-store.js";
import { loadModelPrices } from "./local-usage-prices.js";
import { createModelPricer, type ModelPricer } from "./local-usage-pricing.js";
import { buildLocalUsageView } from "./local-usage-view.js";

/**
 * Local Usage from the native records of every loaded Harness that can read them. Reads are
 * incremental from persisted cursors, and concurrent requests share the read in progress.
 */
export class LocalUsageService {
  #state: LocalUsageState | null = null;
  #reading: Promise<LocalUsageState> | null = null;
  #prices: { price: ModelPricer; refreshAfter: number } | null = null;
  #loadingPrices: Promise<ModelPricer> | null = null;

  constructor(
    private readonly input: {
      adapters: ReadonlyMap<string, HarnessAdapter>;
      descriptors: () => readonly HarnessPluginDescriptor[];
      directory: string;
      /** LiteLLM's public price table as JSON. */
      fetchLiteLlm: () => Promise<unknown>;
      diagnose: (error: unknown) => void;
      now?: () => number;
    },
  ) {}

  async handle(request: JsonRpcRequest): Promise<JsonObject> {
    const params = localUsageQueryParamsSchema.safeParse(request.params);
    if (!params.success) {
      return { error: { code: -32602, message: "Invalid local usage query params" } };
    }
    try {
      // A period switch during a refresh waits for it rather than answering from older totals.
      const [state, price] = await Promise.all([
        params.data.refresh ? this.#read() : (this.#reading ?? this.#state ?? this.#initial()),
        this.#price(),
      ]);
      const descriptors = this.input.descriptors();
      const result = localUsageQueryResultSchema.parse(
        buildLocalUsageView({
          buckets: state.buckets,
          period: params.data.period,
          timeZone: params.data.timeZone,
          now: this.#now(),
          harnessName: (harnessId) =>
            descriptors.find(({ id }) => id === harnessId)?.name ?? harnessId,
          price,
        }),
      );
      return { result: jsonValueSchema.parse(result) };
    } catch (error) {
      this.input.diagnose(error);
      return { error: { code: -32082, message: "Local usage could not be read" } };
    }
  }

  #now(): number {
    return this.input.now?.() ?? Date.now();
  }

  /**
   * Only the first load is awaited. Expired prices keep answering while newer ones load in the
   * background, so an unreachable LiteLLM never delays a query. Concurrent loads are shared.
   */
  async #price(): Promise<ModelPricer> {
    if (!this.#prices) return this.#loadPrices();
    if (this.#now() >= this.#prices.refreshAfter) void this.#loadPrices();
    return this.#prices.price;
  }

  #loadPrices(): Promise<ModelPricer> {
    this.#loadingPrices ??= loadModelPrices({
      directory: this.input.directory,
      now: this.#now(),
      fetchLiteLlm: this.input.fetchLiteLlm,
      diagnose: this.input.diagnose,
    })
      .then(({ prices, refreshAfter }) => {
        const price = createModelPricer(prices);
        this.#prices = { price, refreshAfter };
        return price;
      })
      .finally(() => {
        this.#loadingPrices = null;
      });
    return this.#loadingPrices;
  }

  /** Answers from persisted totals when present; reads native records only the first time. */
  async #initial(): Promise<LocalUsageState> {
    const persisted = await loadLocalUsageState(this.input.directory, this.input.diagnose);
    if (!persisted) return this.#read();
    this.#state ??= persisted;
    return this.#state;
  }

  #read(): Promise<LocalUsageState> {
    this.#reading ??= this.#readSources().finally(() => {
      this.#reading = null;
    });
    return this.#reading;
  }

  async #readSources(): Promise<LocalUsageState> {
    // Start from disk so another Host process's progress is adopted rather than overwritten.
    const state =
      (await loadLocalUsageState(this.input.directory, this.input.diagnose)) ??
      emptyLocalUsageState();
    const sources = [...this.input.adapters].flatMap(([harnessId, adapter]) =>
      adapter.nativeUsage ? [{ harnessId, nativeUsage: adapter.nativeUsage }] : [],
    );
    const batches = await Promise.all(
      sources.map(async ({ harnessId, nativeUsage }) => ({
        harnessId,
        result: await nativeUsage
          .read(state.sources[harnessId]?.cursor ?? null)
          .catch((error: unknown) => ({ ok: false as const, error })),
      })),
    );
    for (const { harnessId, result } of batches) {
      if (!result.ok) {
        // One Harness failing keeps its previous cursor and totals; others still advance.
        this.input.diagnose(new Error(`Local usage read failed for ${harnessId}`));
        continue;
      }
      try {
        applyNativeUsageBatch(state, harnessId, result.value);
      } catch {
        this.input.diagnose(new Error(`Local usage records from ${harnessId} are invalid`));
      }
    }
    await saveLocalUsageState(this.input.directory, state);
    this.#state = state;
    return state;
  }
}
