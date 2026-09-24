import {
  harnessModelCatalogSchema,
  harnessModelRefSchema,
  harnessThinkingOptionIdSchema,
} from "@codexhost/shared-contracts";
import { describe, expect, it } from "vitest";

import { rendererThinkingCardPlacement } from "../src/renderer-model-picker-positioning.js";
import {
  RENDERER_THINKING_GRADIENT,
  RENDERER_THINKING_MAX_STARS,
  rendererThinkingOptionPresentation,
  rendererThinkingSliderIndexAt,
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
    expect(view.visual).toMatchObject({ position: 0, starCount: 0, starOpacity: 0 });
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
    });
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

  it("snaps a pointer to the nearest option and clamps outside the rail", () => {
    const rail = { left: 100, width: 300 };
    expect(rendererThinkingSliderIndexAt(100, rail, 7)).toBe(0);
    expect(rendererThinkingSliderIndexAt(170, rail, 7)).toBe(1);
    expect(rendererThinkingSliderIndexAt(260, rail, 7)).toBe(3);
    expect(rendererThinkingSliderIndexAt(40, rail, 7)).toBe(0);
    expect(rendererThinkingSliderIndexAt(900, rail, 7)).toBe(6);
    expect(rendererThinkingSliderIndexAt(250, rail, 1)).toBe(0);
    expect(rendererThinkingSliderIndexAt(250, { left: 100, width: 0 }, 3)).toBe(0);
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
