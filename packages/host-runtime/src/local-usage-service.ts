import type {
  HarnessAdapter,
  HarnessNativeUsageCapability,
  HarnessNativeUsageProgress,
} from "@codexhost/harness-adapter";
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
import { createProjectResolver } from "./local-usage-projects.js";
import { createModelPricer, type ModelPricer } from "./local-usage-pricing.js";
import { buildLocalUsageView } from "./local-usage-view.js";

const OFFICIAL_CODEX_ID = "codex";
/** How long a query waits for a read before answering with its progress instead. */
const PROGRESS_AFTER_MS = 500;

/**
 * Local Usage from the native records of every loaded Harness that can read them. Reads are
 * incremental from persisted cursors, and concurrent requests share the read in progress.
 */
export class LocalUsageService {
  #state: LocalUsageState | null = null;
  #reading: Promise<LocalUsageState> | null = null;
  #prices: { price: ModelPricer; refreshAfter: number } | null = null;
  #loadingPrices: Promise<ModelPricer> | null = null;
  /** Files read so far by each source during the read in progress. */
  #progress = new Map<string, HarnessNativeUsageProgress>();
  /** Harnesses whose last read failed or returned invalid records. */
  #failed: readonly string[] = [];
  /** A failed read no query was still waiting for, reported to the next query that polls. */
  #unreportedFailure: unknown = null;
  readonly #project = createProjectResolver();

  constructor(
    private readonly input: {
      adapters: ReadonlyMap<string, HarnessAdapter>;
      /** Official Codex has no Adapter; the Codex runtime reads its rollouts. */
      officialCodexUsage?: HarnessNativeUsageCapability;
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
      if (!params.data.refresh && !this.#reading && this.#unreportedFailure !== null) {
        throw this.#unreportedFailure;
      }
      const prices = this.#price();
      // A period switch during a refresh waits for it rather than answering from older totals;
      // a read that takes longer answers with its progress, and the page asks again.
      const state = await this.#awaitBriefly(
        params.data.refresh ? this.#read() : (this.#reading ?? this.#state ?? this.#initial()),
      );
      if (!state) {
        return {
          result: jsonValueSchema.parse(
            localUsageQueryResultSchema.parse({
              status: "reading",
              progress: this.#readProgress(),
            }),
          ),
        };
      }
      const cwds = [...new Set(state.buckets.flatMap(({ cwd }) => (cwd ? [cwd] : [])))];
      const [price, projectNames] = await Promise.all([
        prices,
        Promise.all(cwds.map(async (cwd) => [cwd, await this.#project(cwd)] as const)),
      ]);
      const projects = new Map(projectNames);
      const descriptors = this.input.descriptors();
      const harnessName = (harnessId: string) =>
        descriptors.find(({ id }) => id === harnessId)?.name ??
        (harnessId === OFFICIAL_CODEX_ID ? "Codex" : harnessId);
      const result = localUsageQueryResultSchema.parse(
        buildLocalUsageView({
          buckets: state.buckets,
          period: params.data.period,
          timeZone: params.data.timeZone,
          now: this.#now(),
          harnessName,
          price,
          project: (cwd) => projects.get(cwd),
          failedHarnessIds: this.#failed,
        }),
      );
      return { result: jsonValueSchema.parse(result) };
    } catch (error) {
      // Any query that reports an error has reported a pending read failure too.
      this.#unreportedFailure = null;
      this.input.diagnose(error);
      return { error: { code: -32082, message: "Local usage could not be read" } };
    }
  }

  /** The state, or null when the read it depends on is still running after a short wait. */
  async #awaitBriefly(
    state: LocalUsageState | Promise<LocalUsageState>,
  ): Promise<LocalUsageState | null> {
    if (!(state instanceof Promise)) return state;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        state,
        new Promise<null>((resolve) => {
          timer = setTimeout(resolve, PROGRESS_AFTER_MS, null);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  #readProgress(): HarnessNativeUsageProgress {
    let processed = 0;
    let total = 0;
    for (const progress of this.#progress.values()) {
      processed += progress.processed;
      total += progress.total;
    }
    return { processed, total };
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
    if (!this.#reading) {
      this.#unreportedFailure = null;
      // Replaced before anything awaits, so a query never reports the previous read's progress.
      const progress = new Map<string, HarnessNativeUsageProgress>();
      this.#progress = progress;
      const reading = this.#readSources(progress).finally(() => {
        this.#reading = null;
      });
      // Queries that stopped waiting leave this failure for the next poll to report.
      reading.catch((error: unknown) => {
        this.#unreportedFailure = error;
      });
      this.#reading = reading;
    }
    return this.#reading;
  }

  async #readSources(progress: Map<string, HarnessNativeUsageProgress>): Promise<LocalUsageState> {
    // Start from disk so another Host process's progress is adopted rather than overwritten.
    const state =
      (await loadLocalUsageState(this.input.directory, this.input.diagnose)) ??
      emptyLocalUsageState();
    const { officialCodexUsage } = this.input;
    const sources = [
      ...(officialCodexUsage
        ? [{ harnessId: OFFICIAL_CODEX_ID, nativeUsage: officialCodexUsage }]
        : []),
      ...[...this.input.adapters].flatMap(([harnessId, adapter]) =>
        adapter.nativeUsage ? [{ harnessId, nativeUsage: adapter.nativeUsage }] : [],
      ),
    ];
    const batches = await Promise.all(
      sources.map(async ({ harnessId, nativeUsage }) => ({
        harnessId,
        result: await nativeUsage
          .read(state.sources[harnessId]?.cursor ?? null, (reported) => {
            // Progress is plugin data too; ignore anything that is not a sane file count.
            if (
              Number.isSafeInteger(reported.processed) &&
              Number.isSafeInteger(reported.total) &&
              reported.processed >= 0 &&
              reported.processed <= reported.total
            ) {
              progress.set(harnessId, { processed: reported.processed, total: reported.total });
            }
          })
          .catch((error: unknown) => ({ ok: false as const, error })),
      })),
    );
    const failed: string[] = [];
    for (const { harnessId, result } of batches) {
      if (!result.ok) {
        // One Harness failing keeps its previous cursor and totals; others still advance.
        failed.push(harnessId);
        this.input.diagnose(new Error(`Local usage read failed for ${harnessId}`));
        continue;
      }
      try {
        applyNativeUsageBatch(state, harnessId, result.value);
      } catch {
        failed.push(harnessId);
        this.input.diagnose(new Error(`Local usage records from ${harnessId} are invalid`));
      }
    }
    await saveLocalUsageState(this.input.directory, state);
    this.#state = state;
    this.#failed = failed;
    return state;
  }
}
