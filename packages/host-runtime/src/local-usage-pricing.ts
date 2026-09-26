import type { HarnessNativeUsageTokens } from "@codexhost/harness-adapter";

/** USD per token. A kind LiteLLM does not price is 0. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  /** Five-minute cache writes, and writes whose duration is unknown. */
  cacheWrite: number;
  cacheWrite1h: number;
}

/** Lowercase model name → price. */
export type ModelPriceTable = ReadonlyMap<string, ModelPrice>;

/** Returns null for a model without a price; its usage then costs 0. */
export type ModelPricer = (model: string) => ModelPrice | null;

/** Manual prices; they win over LiteLLM at every matching step. */
export const MODEL_PRICE_OVERRIDES: ModelPriceTable = new Map();

/** Names Harnesses write that LiteLLM lists under another name. */
export const MODEL_ALIASES: ReadonlyMap<string, string> = new Map();

// Context window (`[1m]`), `:variant` and reasoning effort decorations.
const DECORATION_SUFFIX =
  /(?:\[[^\]]*\]|:[^:/]*|-(?:minimal|low|medium|high|xhigh|max|thinking))$/u;

function stripDecorations(name: string): string {
  let current = name;
  for (;;) {
    const next = current.replace(DECORATION_SUFFIX, "");
    if (next === current || next === "") return current;
    current = next;
  }
}

function withoutVendor(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

/** Unprefixed names, plus bare names of vendor-prefixed entries (first vendor in name order). */
function byBareName(table: ModelPriceTable): Map<string, ModelPrice> {
  const names = new Map<string, ModelPrice>();
  const prefixed = new Map<string, string>();
  for (const name of table.keys()) {
    if (!name.includes("/")) continue;
    const bare = withoutVendor(name);
    if (bare === "") continue;
    const chosen = prefixed.get(bare);
    if (chosen === undefined || name < chosen) prefixed.set(bare, name);
  }
  for (const [bare, name] of prefixed) {
    const price = table.get(name);
    if (price) names.set(bare, price);
  }
  for (const [name, price] of table) {
    if (!name.includes("/")) names.set(name, price);
  }
  return names;
}

// Short or digit-free names such as `fast`, `auto` or `o1` would match unrelated models.
function isSpecificName(name: string): boolean {
  return name.length >= 5 && /\d/u.test(name) && /[a-z]/u.test(name);
}

function longestContained(
  names: ReadonlyMap<string, ModelPrice>,
  sortedNames: readonly string[],
  model: string,
): ModelPrice | null {
  const name = sortedNames.find((candidate) => model.includes(candidate));
  return name === undefined ? null : (names.get(name) ?? null);
}

/**
 * Matches a model name by exact name, alias, decoration suffix, vendor prefix and finally the
 * longest known name it contains. Manual overrides are checked before LiteLLM at each step.
 */
export function createModelPricer(
  litellm: ModelPriceTable,
  manual: { overrides: ModelPriceTable; aliases: ReadonlyMap<string, string> } = {
    overrides: MODEL_PRICE_OVERRIDES,
    aliases: MODEL_ALIASES,
  },
): ModelPricer {
  // Overrides first, so they win at every step.
  const sources = [manual.overrides, litellm].map((table) => {
    const bare = byBareName(table);
    const contained = [...bare.keys()]
      .filter(isSpecificName)
      .sort((left, right) => right.length - left.length);
    return { table, bare, contained };
  });
  const first = (lookup: (source: (typeof sources)[number]) => ModelPrice | null | undefined) =>
    sources.reduce<ModelPrice | null>((found, source) => found ?? lookup(source) ?? null, null);
  const resolved = new Map<string, ModelPrice | null>();

  function resolve(model: string): ModelPrice | null {
    const alias = manual.aliases.get(model);
    const stripped = stripDecorations(model);
    const unprefixed = withoutVendor(stripped);
    return (
      first(({ table }) => table.get(model)) ??
      (alias === undefined ? null : first(({ table }) => table.get(alias))) ??
      first(({ table }) => table.get(stripped)) ??
      first(({ bare }) => bare.get(unprefixed)) ??
      first(({ bare, contained }) => longestContained(bare, contained, unprefixed))
    );
  }

  return (model) => {
    const name = model.trim().toLowerCase();
    if (name === "") return null;
    let price = resolved.get(name);
    if (price === undefined) {
      price = resolve(name);
      resolved.set(name, price);
    }
    return price;
  };
}

/**
 * Reasoning is priced as output; Adapters report it only when it is not already in output.
 * One-hour cache writes are part of `cacheWrite` and priced at their own rate.
 */
export function usageCostUsd(tokens: HarnessNativeUsageTokens, price: ModelPrice | null): number {
  if (!price) return 0;
  const cacheWrite1h = tokens.cacheWrite1h ?? 0;
  return (
    tokens.input * price.input +
    tokens.cacheRead * price.cacheRead +
    (tokens.cacheWrite - cacheWrite1h) * price.cacheWrite +
    cacheWrite1h * price.cacheWrite1h +
    (tokens.output + tokens.reasoning) * price.output
  );
}
