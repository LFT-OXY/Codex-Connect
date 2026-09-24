import {
  harnessModelCatalogSchema,
  harnessModelRefSchema,
  harnessThinkingOptionIdSchema,
} from "@codexhost/shared-contracts";
import { describe, expect, it } from "vitest";

import { rendererThinkingCardPlacement } from "../src/renderer-model-picker-positioning.js";
import {
  RENDERER_THINKING_FLOW,
  RENDERER_THINKING_GRADIENT,
  RENDERER_THINKING_MAX_STARS,
  rendererThinkingOptionPresentation,
  rendererThinkingSliderPointerAt,
  rendererThinkingSliderVisual,
} from "../src/renderer-thinking-option-picker.js";

const model = harnessModelRefSchema.parse({ id: "claude-model-v1.c29ubmV0" });

const CLAUDE_CODE_OPTIONS = [
  { id: "off", label: "Off" },
  { id: "auto", label: "Auto" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
  { id: "max", label: "Max" },
];

function catalog(options: readonly { id: string; label: string }[], supported?: string[]) {
  return harnessModelCatalogSchema.parse({
    models: [
      {
        ref: model,
        label: "Sonnet",
        ...(supported === undefined
          ? { supportedThinkingOptionIds: options.map(({ id }) => id) }
          : supported.length > 0
            ? { supportedThinkingOptionIds: supported }
            : {}),
      },
    ],
    defaultModel: model,
    thinkingOptions: options,
  });
}

function rgb([red, green, blue]: readonly [number, number, number]): string {
  return `rgb(${red}, ${green}, ${blue})`;
}

describe("Renderer Thinking Option presentation", () => {
  it("lays out the full Claude Code sequence in Harness order", () => {
    const view = rendererThinkingOptionPresentation({
      status: "ready",
      catalog: catalog(CLAUDE_CODE_OPTIONS),
      selected: model,
      selectedThinkingOptionId: harnessThinkingOptionIdSchema.parse("high"),
      thinkingSelectionSupported: true,
    });

    expect(view).toMatchObject({
      visible: true,
      label: "High",
      modelLabel: "Sonnet",
      selectedIndex: 4,
      readOnly: false,
      disabled: false,
    });
    expect(view.options.map(({ label }) => label)).toEqual([
      "Off",
      "Auto",
      "Low",
      "Medium",
      "High",
      "Extra High",
      "Max",
    ]);
    expect(view.visual.position).toBeCloseTo(4 / 6);
  });

  it("allows switching between two options", () => {
    const view = rendererThinkingOptionPresentation({
      status: "ready",
      catalog: catalog([
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ]),
      selected: model,
      selectedThinkingOptionId: harnessThinkingOptionIdSchema.parse("low"),
    });

    expect(view).toMatchObject({ visible: true, label: "Low", selectedIndex: 0, readOnly: false });
    expect(view.visual).toMatchObject({ position: 0, starCount: 0 });
  });

  it("shows a single non-off option read-only", () => {
    const view = rendererThinkingOptionPresentation({
      status: "ready",
      catalog: catalog([{ id: "minimal", label: "Minimal" }]),
      selected: model,
      selectedThinkingOptionId: harnessThinkingOptionIdSchema.parse("minimal"),
    });

    expect(view).toMatchObject({
      visible: true,
      label: "Minimal",
      selectedIndex: 0,
      readOnly: true,
    });
    expect(view.visual).toMatchObject({
      position: 0,
      starCount: 0,
      starOpacity: 0,
      sheenSeconds: 0,
      driftSeconds: 0,
    });
  });

  it("hides the pill when the Model supports only off", () => {
    expect(
      rendererThinkingOptionPresentation({
        status: "ready",
        catalog: catalog([{ id: "off", label: "Off" }]),
        selected: model,
        selectedThinkingOptionId: harnessThinkingOptionIdSchema.parse("off"),
      }).visible,
    ).toBe(false);
  });

  it("hides the pill when the Harness cannot select Thinking Options", () => {
    expect(
      rendererThinkingOptionPresentation({
        status: "ready",
        catalog: catalog(CLAUDE_CODE_OPTIONS),
        selected: model,
        selectedThinkingOptionId: harnessThinkingOptionIdSchema.parse("high"),
        thinkingSelectionSupported: false,
      }).visible,
    ).toBe(false);
  });

  it("does not reuse global options for a Model without a declared list", () => {
    const view = rendererThinkingOptionPresentation({
      status: "ready",
      catalog: catalog(CLAUDE_CODE_OPTIONS, []),
      selected: model,
      selectedThinkingOptionId: harnessThinkingOptionIdSchema.parse("high"),
    });

    expect(view.visible).toBe(false);
    expect(view.options).toEqual([]);
  });

  it("disables the pill while loading or selecting", () => {
    expect(rendererThinkingOptionPresentation({ status: "loading" })).toMatchObject({
      visible: false,
      disabled: true,
    });
    expect(
      rendererThinkingOptionPresentation({
        status: "selecting",
        catalog: catalog(CLAUDE_CODE_OPTIONS),
        selected: model,
        selectedThinkingOptionId: harnessThinkingOptionIdSchema.parse("high"),
      }),
    ).toMatchObject({ visible: true, disabled: true, label: "High" });
  });

  it("keeps the pill visible without a label when the selection is not yet confirmed", () => {
    const view = rendererThinkingOptionPresentation({
      status: "ready",
      catalog: catalog(CLAUDE_CODE_OPTIONS),
      selected: model,
    });

    expect(view.visible).toBe(true);
    expect(view.label).toBeUndefined();
    expect(view.selectedIndex).toBe(-1);
    expect(view.visual.position).toBe(0);
  });
});

describe("Renderer Thinking slider visual", () => {
  it("has no fill and no stars at the first option", () => {
    expect(rendererThinkingSliderVisual(0, 7)).toEqual({
      position: 0,
      color: {
        light: rgb(RENDERER_THINKING_GRADIENT.light.from),
        dark: rgb(RENDERER_THINKING_GRADIENT.dark.from),
      },
      starCount: 0,
      starOpacity: 0,
      sheenSeconds: 0,
      driftSeconds: 0,
    });
  });

  it("fills completely with the densest, brightest stars at the last option", () => {
    expect(rendererThinkingSliderVisual(6, 7)).toEqual({
      position: 1,
      color: {
        light: rgb(RENDERER_THINKING_GRADIENT.light.to),
        dark: rgb(RENDERER_THINKING_GRADIENT.dark.to),
      },
      starCount: RENDERER_THINKING_MAX_STARS,
      starOpacity: 1,
      sheenSeconds: RENDERER_THINKING_FLOW.sheen.fastest,
      driftSeconds: RENDERER_THINKING_FLOW.drift.fastest,
    });
  });

  it("flows faster as the position grows", () => {
    const visuals = [1, 2, 3, 4, 5, 6].map((index) => rendererThinkingSliderVisual(index, 7));
    visuals.slice(1).forEach((visual, index) => {
      const previous = visuals[index];
      expect(visual.sheenSeconds).toBeLessThan(previous?.sheenSeconds ?? -Infinity);
      expect(visual.driftSeconds).toBeLessThan(previous?.driftSeconds ?? -Infinity);
    });
    // 与 prd.md「修订 3 实现记录」写回的数值一致。
    expect(visuals[0]).toMatchObject({ sheenSeconds: 2.9, driftSeconds: 8.08 });
    expect(visuals[5]).toMatchObject({ sheenSeconds: 1.4, driftSeconds: 3.5 });
  });

  it("grows stars and brightness with the relative position", () => {
    const visuals = [1, 2, 3, 4, 5, 6].map((index) => rendererThinkingSliderVisual(index, 7));
    visuals.slice(1).forEach((visual, index) => {
      const previous = visuals[index];
      expect(visual.starCount).toBeGreaterThanOrEqual(previous?.starCount ?? Infinity);
      expect(visual.starOpacity).toBeGreaterThan(previous?.starOpacity ?? Infinity);
    });
    expect(visuals[0]?.starCount).toBeGreaterThan(0);
  });

  it("packs stars more densely along the fill as the position grows", () => {
    const density = (index: number): number => {
      const visual = rendererThinkingSliderVisual(index, 7);
      return visual.starCount / visual.position;
    };
    expect(density(6)).toBeGreaterThan(density(3));
    expect(density(3)).toBeGreaterThan(density(1));
  });

  it("treats a single option as the start of the sequence", () => {
    expect(rendererThinkingSliderVisual(0, 1)).toMatchObject({ position: 0, starCount: 0 });
  });

  it("follows the pointer continuously and reports the nearest option", () => {
    const track = { left: 100, width: 300 };
    expect(rendererThinkingSliderPointerAt(100, track, 7)).toEqual({ position: 0, index: 0 });
    expect(rendererThinkingSliderPointerAt(250, track, 7)).toEqual({ position: 0.5, index: 3 });
    const between = rendererThinkingSliderPointerAt(170, track, 7);
    expect(between.position).toBeCloseTo(70 / 300);
    expect(between.index).toBe(1);
    expect(rendererThinkingSliderPointerAt(260, track, 7).index).toBe(3);
  });

  it("clamps a pointer outside the track and handles degenerate tracks", () => {
    const track = { left: 100, width: 300 };
    expect(rendererThinkingSliderPointerAt(40, track, 7)).toEqual({ position: 0, index: 0 });
    expect(rendererThinkingSliderPointerAt(900, track, 7)).toEqual({ position: 1, index: 6 });
    expect(rendererThinkingSliderPointerAt(250, track, 1)).toEqual({ position: 0, index: 0 });
    expect(rendererThinkingSliderPointerAt(250, { left: 100, width: 0 }, 3)).toEqual({
      position: 0,
      index: 0,
    });
  });

  it("snaps to the option whose visual position is nearest", () => {
    const track = { left: 0, width: 600 };
    for (let x = 0; x <= 600; x += 25) {
      const { position, index } = rendererThinkingSliderPointerAt(x, track, 7);
      const snapped = rendererThinkingSliderVisual(index, 7).position;
      expect(Math.abs(snapped - position)).toBeLessThanOrEqual(1 / 12 + 1e-9);
    }
  });
});

describe("Renderer Thinking card placement", () => {
  it("opens above the pill with its left edge aligned", () => {
    expect(
      rendererThinkingCardPlacement(
        { left: 700, right: 760, top: 820 },
        { width: 1200, height: 900 },
      ),
    ).toEqual({ left: 700, width: 248, bottom: 88 });
  });

  it("pulls the card back inside the right viewport edge", () => {
    expect(
      rendererThinkingCardPlacement(
        { left: 1100, right: 1160, top: 820 },
        { width: 1200, height: 900 },
      ).left,
    ).toBe(1200 - 8 - 248);
  });

  it("narrows the card for a viewport smaller than the card", () => {
    expect(
      rendererThinkingCardPlacement(
        { left: 50, right: 110, top: 820 },
        { width: 200, height: 900 },
      ),
    ).toEqual({ left: 8, width: 184, bottom: 88 });
  });
});
