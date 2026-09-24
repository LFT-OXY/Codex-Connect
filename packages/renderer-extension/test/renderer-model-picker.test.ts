import {
  harnessModelCatalogSchema,
  harnessModelRefSchema,
  harnessThinkingOptionIdSchema,
} from "@codexhost/shared-contracts";
import { describe, expect, it } from "vitest";

import { rendererModelPickerStandaloneModelMenuPlacement } from "../src/renderer-model-picker-positioning.js";

import {
  isRendererModelPickerDisabled,
  rendererModelPickerPresentation,
  shouldCloseRendererModelPicker,
  syncRendererLabelText,
} from "../src/renderer-model-picker.js";

const model = harnessModelRefSchema.parse({ id: "pi-model-v1.synthetic" });

function catalog(levels: readonly string[]) {
  const thinkingOptions = levels.map((id) => ({
    id: harnessThinkingOptionIdSchema.parse(id),
    label: id === "xhigh" ? "Extra High" : `${id[0]?.toUpperCase() ?? ""}${id.slice(1)}`,
  }));
  return harnessModelCatalogSchema.parse({
    models: [
      {
        ref: model,
        label: "provider / model",
        supportedThinkingOptionIds: thinkingOptions.map(({ id }) => id),
      },
    ],
    defaultModel: model,
    thinkingOptions,
    ...(thinkingOptions[0] ? { defaultThinkingOptionId: thinkingOptions[0].id } : {}),
  });
}

describe("Renderer Model picker presentation", () => {
  it("opens the Model list directly above the model trigger", () => {
    expect(
      rendererModelPickerStandaloneModelMenuPlacement(
        { left: 700, right: 900, top: 820 },
        { width: 1200, height: 900 },
      ),
    ).toEqual({ left: 620, width: 280, maxHeight: 360, bottom: 88 });
  });

  it("keeps the Model list inside the viewport when the trigger is near an edge", () => {
    expect(
      rendererModelPickerStandaloneModelMenuPlacement(
        { left: 0, right: 50, top: 820 },
        { width: 240, height: 900 },
      ),
    ).toMatchObject({ left: 8, width: 224 });
  });

  it("does not rewrite an unchanged label", () => {
    let value: string | null = "High";
    let writes = 0;
    const element = {
      get textContent() {
        return value;
      },
      set textContent(next: string | null) {
        writes += 1;
        value = next;
      },
    };

    expect(syncRendererLabelText(element, "High")).toBe(false);
    expect(writes).toBe(0);
    expect(syncRendererLabelText(element, "Extra High")).toBe(true);
    expect(syncRendererLabelText(element, "Extra High")).toBe(false);
    expect(writes).toBe(1);
  });

  it("shows only the Model label, without the Thinking Option", () => {
    expect(
      rendererModelPickerPresentation({
        status: "ready",
        catalog: catalog(["off", "low", "high"]),
        selected: model,
        selectedThinkingOptionId: harnessThinkingOptionIdSchema.parse("high"),
      }),
    ).toEqual({ modelLabel: "provider / model" });
  });

  it("shows a runtime-resolved Model label after the selected Model", () => {
    const claudeModel = harnessModelRefSchema.parse({ id: "claude-model-v1.c29ubmV0" });
    const claudeCatalog = harnessModelCatalogSchema.parse({
      models: [
        {
          ref: claudeModel,
          label: "Family alias",
          resolvedModelLabel: "runtime-custom",
          supportedThinkingOptionIds: ["low", "high"],
        },
      ],
      defaultModel: claudeModel,
      thinkingOptions: [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ],
    });

    expect(
      rendererModelPickerPresentation({
        status: "ready",
        catalog: claudeCatalog,
        selected: claudeModel,
        thinkingSelectionSupported: false,
      }),
    ).toEqual({
      modelLabel: "Family alias",
      resolvedModelLabel: "runtime-custom",
    });
  });

  it("does not repeat a resolved label identical to the Model label", () => {
    const sameCatalog = harnessModelCatalogSchema.parse({
      models: [{ ref: model, label: "provider / model", resolvedModelLabel: "provider / model" }],
      defaultModel: model,
      thinkingOptions: [],
    });

    expect(
      rendererModelPickerPresentation({ status: "ready", catalog: sameCatalog, selected: model }),
    ).toEqual({ modelLabel: "provider / model" });
  });

  it("disables the Model control for loading and selection, but permits retry", () => {
    const readyCatalog = catalog(["off", "low"]);
    expect(isRendererModelPickerDisabled({ status: "loading" })).toBe(true);
    const selectingView = {
      status: "selecting" as const,
      catalog: readyCatalog,
      selected: model,
    };
    expect(isRendererModelPickerDisabled(selectingView)).toBe(true);
    expect(shouldCloseRendererModelPicker(selectingView)).toBe(false);
    expect(shouldCloseRendererModelPicker({ status: "loading" })).toBe(true);
    expect(
      isRendererModelPickerDisabled({
        status: "error",
        catalog: readyCatalog,
        selected: model,
        error: "selection failed",
      }),
    ).toBe(false);
    expect(isRendererModelPickerDisabled({ status: "error", error: "inspection failed" })).toBe(
      true,
    );
  });

  it("uses stable loading, empty and unavailable labels", () => {
    for (const status of ["waitingForAdapter", "loading"] as const) {
      expect(isRendererModelPickerDisabled({ status })).toBe(true);
      expect(rendererModelPickerPresentation({ status })).toEqual({
        modelLabel: "Loading models...",
      });
    }
    expect(rendererModelPickerPresentation({ status: "empty" })).toEqual({
      modelLabel: "No models",
    });
    expect(rendererModelPickerPresentation({ status: "error" })).toEqual({
      modelLabel: "Models unavailable",
    });
  });
});
