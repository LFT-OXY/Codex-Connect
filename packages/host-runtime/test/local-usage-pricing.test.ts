import { describe, expect, it } from "vitest";

import { createModelPricer, usageCostUsd } from "../src/local-usage-pricing.js";

// USD per token.
const OPUS = {
  input: 5e-6,
  output: 25e-6,
  cacheRead: 0.5e-6,
  cacheWrite: 6.25e-6,
  cacheWrite1h: 10e-6,
};
const OPUS_FAST = {
  input: 10e-6,
  output: 50e-6,
  cacheRead: 1e-6,
  cacheWrite: 12.5e-6,
  cacheWrite1h: 20e-6,
};
const SOL_AZURE = { input: 4e-6, output: 20e-6, cacheRead: 0.4e-6, cacheWrite: 0, cacheWrite1h: 0 };
const SOL_CHATGPT = {
  input: 3e-6,
  output: 18e-6,
  cacheRead: 0.3e-6,
  cacheWrite: 0,
  cacheWrite1h: 0,
};
const GEMINI = {
  input: 0.75e-6,
  output: 3.75e-6,
  cacheRead: 0.075e-6,
  cacheWrite: 0,
  cacheWrite1h: 0,
};
const MANUAL = { input: 1e-6, output: 2e-6, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };

const LITELLM = new Map([
  ["claude-opus-5", OPUS],
  ["claude-opus-5-fast", OPUS_FAST],
  ["chatgpt/gpt-5.6-sol", SOL_CHATGPT],
  ["azure/gpt-5.6-sol", SOL_AZURE],
  ["gemini-3.6-flash", GEMINI],
  ["vertex_ai/gemini-3.6-flash", SOL_AZURE],
]);

describe("model price matching", () => {
  const price = createModelPricer(LITELLM, { overrides: new Map(), aliases: new Map() });

  it("matches exact names regardless of case", () => {
    expect(price("claude-opus-5")).toEqual(OPUS);
    expect(price("Claude-Opus-5")).toEqual(OPUS);
    // A decorated name that is itself priced keeps its own price.
    expect(price("claude-opus-5-fast")).toEqual(OPUS_FAST);
  });

  it("strips context, effort and variant suffixes", () => {
    expect(price("claude-opus-5[1m]")).toEqual(OPUS);
    expect(price("claude-opus-5-high")).toEqual(OPUS);
    expect(price("claude-opus-5-thinking")).toEqual(OPUS);
    expect(price("gemini-3.6-flash:max")).toEqual(GEMINI);
  });

  it("strips vendor prefixes from the model and from table names", () => {
    expect(price("Anthropic/claude-opus-5")).toEqual(OPUS);
    expect(price("3oxy-claude/claude-opus-5:high")).toEqual(OPUS);
    // Only prefixed entries exist: the first vendor in name order is chosen deterministically.
    expect(price("gpt-5.6-sol")).toEqual(SOL_AZURE);
    expect(price("openai-codex/gpt-5.6-sol")).toEqual(SOL_AZURE);
  });

  it("falls back to the longest table name contained in the model", () => {
    expect(price("my-claude-opus-5-fast-preview")).toEqual(OPUS_FAST);
    expect(price("proxy.claude-opus-5.v2")).toEqual(OPUS);
  });

  it("returns null for unknown models", () => {
    expect(price("qwen-abliterated")).toBeNull();
    expect(price("")).toBeNull();
  });

  it("never falls back to generic or empty table names", () => {
    const generic = createModelPricer(
      new Map([
        ["fast", MANUAL],
        ["router/", MANUAL],
        ["o1", MANUAL],
        ["gpt-5", GEMINI],
      ]),
      { overrides: new Map(), aliases: new Map() },
    );
    expect(generic("local-fast-model")).toBeNull();
    expect(generic("opus")).toBeNull();
    expect(generic("foo1")).toBeNull();
    expect(generic("custom-gpt-5-preview")).toEqual(GEMINI);
  });

  it("resolves aliases and lets manual overrides win at every step", () => {
    const manual = createModelPricer(LITELLM, {
      overrides: new Map([
        ["claude-opus-5", MANUAL],
        ["house-model-7", MANUAL],
      ]),
      aliases: new Map([["opus-latest", "claude-opus-5-fast"]]),
    });
    expect(manual("claude-opus-5")).toEqual(MANUAL);
    expect(manual("claude-opus-5[1m]")).toEqual(MANUAL);
    expect(manual("house-model-7-preview")).toEqual(MANUAL);
    expect(manual("opus-latest")).toEqual(OPUS_FAST);
    // An exact LiteLLM name is more specific than an override for its stripped form.
    expect(manual("claude-opus-5-fast")).toEqual(OPUS_FAST);
  });
});

describe("usage cost", () => {
  it("prices each token kind and reasoning at the output price", () => {
    const tokens = {
      input: 1_000_000,
      cacheRead: 2_000_000,
      cacheWrite: 100_000,
      output: 10_000,
      reasoning: 4_000,
    };
    // 5 + 1 + 0.625 + 0.25 + 0.1
    expect(usageCostUsd(tokens, OPUS)).toBeCloseTo(6.975, 10);
  });

  it("prices one-hour cache writes at their own price and the rest at the five-minute price", () => {
    const tokens = {
      input: 0,
      cacheRead: 0,
      cacheWrite: 100_000,
      cacheWrite1h: 40_000,
      output: 0,
      reasoning: 0,
    };
    // 60,000 × $6.25/M + 40,000 × $10/M
    expect(usageCostUsd(tokens, OPUS)).toBeCloseTo(0.375 + 0.4, 10);
    expect(usageCostUsd({ ...tokens, cacheWrite1h: 0 }, OPUS)).toBeCloseTo(0.625, 10);
  });

  it("does not charge reasoning again when a Harness reports it only inside output", () => {
    const tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 1_000_000, reasoning: 0 };
    expect(usageCostUsd(tokens, OPUS)).toBeCloseTo(25, 10);
  });

  it("is zero without a price", () => {
    const tokens = { input: 1, cacheRead: 1, cacheWrite: 1, output: 1, reasoning: 1 };
    expect(usageCostUsd(tokens, null)).toBe(0);
  });
});
