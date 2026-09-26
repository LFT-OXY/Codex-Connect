import {
  harnessIdSchema,
  type HarnessSessionImportCandidate,
  type HostThreadId,
  type LocalSession,
  type LocalSessionsView,
} from "@codexhost/shared-contracts";

import { usageCostUsd, type ModelPricer } from "./local-usage-pricing.js";
import type { LocalSessionSummary, LocalSessionUsage } from "./local-usage-store.js";

interface SessionNode {
  harnessId: string;
  nativeSessionId: string;
  parentSessionId: string | null;
  title: string | null;
  cwd: string | null;
  model: string | null;
  firstActivityAt: number;
  lastActivityAt: number;
  activeMs: number;
  turns: number;
  edits: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

function sessionKey(harnessId: string, nativeSessionId: string): string {
  return JSON.stringify([harnessId, nativeSessionId]);
}

/** Summaries of several record files of one Session add up; the latest names it. */
function mergeSummaries(summaries: readonly LocalSessionSummary[]): Map<string, SessionNode> {
  const nodes = new Map<string, SessionNode>();
  const latest = [...summaries].sort((left, right) => left.lastActivityAt - right.lastActivityAt);
  for (const summary of latest) {
    const key = sessionKey(summary.harnessId, summary.nativeSessionId);
    const node = nodes.get(key);
    if (!node) {
      nodes.set(key, {
        harnessId: summary.harnessId,
        nativeSessionId: summary.nativeSessionId,
        parentSessionId: summary.parentSessionId,
        title: summary.title,
        cwd: summary.cwd,
        model: summary.model,
        firstActivityAt: summary.firstActivityAt,
        lastActivityAt: summary.lastActivityAt,
        activeMs: summary.activeMs,
        turns: summary.turns,
        edits: summary.edits,
        totalTokens: 0,
        estimatedCostUsd: 0,
      });
      continue;
    }
    node.parentSessionId ??= summary.parentSessionId;
    node.title = summary.title ?? node.title;
    node.cwd = summary.cwd ?? node.cwd;
    node.model = summary.model ?? node.model;
    node.firstActivityAt = Math.min(node.firstActivityAt, summary.firstActivityAt);
    node.lastActivityAt = Math.max(node.lastActivityAt, summary.lastActivityAt);
    node.activeMs += summary.activeMs;
    node.turns += summary.turns;
    node.edits += summary.edits;
  }
  return nodes;
}

/** The main Session a node folds into; a missing parent or a cycle leaves it on its own. */
function rootOf(nodes: ReadonlyMap<string, SessionNode>, node: SessionNode): SessionNode {
  const seen = new Set<SessionNode>([node]);
  let current = node;
  while (current.parentSessionId !== null) {
    const parent = nodes.get(sessionKey(current.harnessId, current.parentSessionId));
    if (!parent) return current;
    if (seen.has(parent)) return node;
    seen.add(parent);
    current = parent;
  }
  return current;
}

/** A Session import candidate of a Harness without native usage; it is listed without usage. */
export interface LocalSessionCandidate {
  harnessId: string;
  candidate: HarnessSessionImportCandidate;
}

/**
 * Lists main Sessions with their subagents folded in. Tokens and cost include subagents; turns,
 * edits and active time are the main Session's own. Session import candidates not already listed
 * are added without usage.
 */
export function buildLocalSessionsView(input: {
  summaries: readonly LocalSessionSummary[];
  usage: readonly LocalSessionUsage[];
  price: ModelPricer;
  harnessName(harnessId: string): string;
  /** Project name of a working directory in `summaries`. */
  project(cwd: string): string | undefined;
  /** The Thread a Native Session is mapped to. */
  threadId(harnessId: string, nativeSessionId: string): HostThreadId | undefined;
  resumable(harnessId: string): boolean;
  candidates: readonly LocalSessionCandidate[];
  failedHarnessIds: readonly string[];
}): LocalSessionsView {
  const nodes = mergeSummaries(input.summaries);
  for (const usage of input.usage) {
    const node = nodes.get(sessionKey(usage.harnessId, usage.nativeSessionId));
    if (!node) continue;
    node.totalTokens +=
      usage.input + usage.cacheRead + usage.cacheWrite + usage.output + usage.reasoning;
    // Priced now rather than when read, so updated prices apply to earlier usage too.
    node.estimatedCostUsd +=
      usage.reportedCostUsd ??
      (usage.model === null ? 0 : usageCostUsd(usage, input.price(usage.model)));
  }
  const roots = new Map<
    SessionNode,
    { tokens: number; cost: number; last: number; subagents: number }
  >();
  for (const node of nodes.values()) {
    const root = rootOf(nodes, node);
    let tree = roots.get(root);
    if (!tree) {
      tree = { tokens: 0, cost: 0, last: root.lastActivityAt, subagents: 0 };
      roots.set(root, tree);
    }
    tree.tokens += node.totalTokens;
    tree.cost += node.estimatedCostUsd;
    tree.last = Math.max(tree.last, node.lastActivityAt);
    if (node !== root) tree.subagents += 1;
  }
  const sessions: LocalSession[] = [];
  const harnesses = new Set<string>();
  let foldedSubagents = 0;
  for (const [root, tree] of roots) {
    // A Session that never reached the model has nothing to show or resume.
    if (tree.tokens === 0) continue;
    harnesses.add(root.harnessId);
    foldedSubagents += tree.subagents;
    sessions.push({
      harnessId: harnessIdSchema.parse(root.harnessId),
      nativeSessionId: root.nativeSessionId,
      title: root.title,
      cwd: root.cwd || null,
      project: (root.cwd && input.project(root.cwd)) || null,
      model: root.model,
      startedAt: root.firstActivityAt,
      lastActivityAt: tree.last,
      activeMs: root.activeMs,
      usage: { totalTokens: tree.tokens, estimatedCostUsd: tree.cost },
      turns: root.turns,
      edits: root.edits,
      subagents: tree.subagents,
      threadId: input.threadId(root.harnessId, root.nativeSessionId) ?? null,
      resumable: input.resumable(root.harnessId),
      running: null,
    });
  }
  const listed = new Set(
    sessions.map(({ harnessId, nativeSessionId }) => sessionKey(harnessId, nativeSessionId)),
  );
  for (const { harnessId, candidate } of input.candidates) {
    const key = sessionKey(harnessId, candidate.nativeSessionId);
    if (listed.has(key)) continue;
    listed.add(key);
    harnesses.add(harnessId);
    sessions.push({
      harnessId: harnessIdSchema.parse(harnessId),
      nativeSessionId: candidate.nativeSessionId,
      title: candidate.title,
      cwd: candidate.cwd,
      project: input.project(candidate.cwd) ?? null,
      model: null,
      startedAt: null,
      lastActivityAt: candidate.updatedAt,
      activeMs: null,
      usage: null,
      turns: null,
      edits: null,
      subagents: 0,
      threadId: input.threadId(harnessId, candidate.nativeSessionId) ?? null,
      resumable: input.resumable(harnessId),
      running: candidate.running,
    });
  }
  sessions.sort(
    (left, right) =>
      right.lastActivityAt - left.lastActivityAt ||
      left.nativeSessionId.localeCompare(right.nativeSessionId, "en"),
  );
  return {
    status: "ready",
    sessions,
    foldedSubagents,
    harnesses: [...harnesses].map((harnessId) => ({
      harnessId: harnessIdSchema.parse(harnessId),
      name: input.harnessName(harnessId),
    })),
    failures: input.failedHarnessIds.map((harnessId) => ({
      harnessId: harnessIdSchema.parse(harnessId),
      name: input.harnessName(harnessId),
    })),
  };
}
