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
import { buildLocalUsageView } from "./local-usage-view.js";

/**
 * Local Usage from the native records of every loaded Harness that can read them. Reads are
 * incremental from persisted cursors, and concurrent requests share the read in progress.
 */
export class LocalUsageService {
  #state: LocalUsageState | null = null;
  #reading: Promise<LocalUsageState> | null = null;

  constructor(
    private readonly input: {
      adapters: ReadonlyMap<string, HarnessAdapter>;
      descriptors: () => readonly HarnessPluginDescriptor[];
      directory: string;
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
      const state = params.data.refresh
        ? await this.#read()
        : await (this.#reading ?? this.#state ?? this.#initial());
      const descriptors = this.input.descriptors();
      const result = localUsageQueryResultSchema.parse(
        buildLocalUsageView({
          buckets: state.buckets,
          period: params.data.period,
          timeZone: params.data.timeZone,
          now: this.input.now?.() ?? Date.now(),
          harnessName: (harnessId) =>
            descriptors.find(({ id }) => id === harnessId)?.name ?? harnessId,
        }),
      );
      return { result: jsonValueSchema.parse(result) };
    } catch (error) {
      this.input.diagnose(error);
      return { error: { code: -32082, message: "Local usage could not be read" } };
    }
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
