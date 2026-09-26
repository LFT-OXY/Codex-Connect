import type { HarnessAdapter } from "@codexhost/harness-adapter";
import { harnessSessionImportCandidateSchema } from "@codexhost/shared-contracts";

import type { LocalSessionCandidate } from "./local-sessions-view.js";

/** A Harness listing its candidates for longer than this is reported as failed. */
const CANDIDATE_LIST_TIMEOUT_MS = 5_000;

export interface LocalSessionCandidates {
  candidates: LocalSessionCandidate[];
  /** Harnesses whose candidates could not be listed. */
  failed: string[];
}

/**
 * Session import candidates of Harnesses that can map existing Sessions but have no native usage,
 * such as Hermes and DSH. Harnesses with native usage list their Sessions from their records.
 */
export async function listLocalSessionCandidates(
  adapters: ReadonlyMap<string, HarnessAdapter>,
  diagnose: (error: unknown) => void,
): Promise<LocalSessionCandidates> {
  const listed = await Promise.all(
    [...adapters].flatMap(([harnessId, adapter]) => {
      const capability = adapter.sessionImport;
      if (adapter.nativeUsage || !capability?.resolveCandidate) return [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(resolve, CANDIDATE_LIST_TIMEOUT_MS, null);
      });
      return [
        Promise.race([capability.listCandidates().catch(() => null), timeout])
          .finally(() => clearTimeout(timer))
          .then((result) => {
            // Candidates are plugin data; a malformed list fails like Session import rejects it.
            const parsed = result?.ok
              ? harnessSessionImportCandidateSchema.array().safeParse(result.value)
              : null;
            const candidates =
              parsed?.success &&
              new Set(parsed.data.map(({ nativeSessionId }) => nativeSessionId)).size ===
                parsed.data.length
                ? parsed.data
                : null;
            return { harnessId, candidates };
          }),
      ];
    }),
  );
  const failed = listed.flatMap(({ harnessId, candidates }) => (candidates ? [] : [harnessId]));
  for (const harnessId of failed) {
    diagnose(new Error(`Session import candidates could not be listed for ${harnessId}`));
  }
  return {
    candidates: listed.flatMap(({ harnessId, candidates }) =>
      (candidates ?? []).map((candidate) => ({ harnessId, candidate })),
    ),
    failed,
  };
}
