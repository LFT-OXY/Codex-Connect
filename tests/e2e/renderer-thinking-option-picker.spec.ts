import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });

const { outputFiles } = await build({
  stdin: {
    contents: `
      import {
        mountRendererThinkingOptionPicker,
        renderRendererThinkingOptionPicker,
      } from "./packages/renderer-extension/src/renderer-thinking-option-picker.ts";

      const LABELS = {
        off: "Off", auto: "Auto", low: "Low", medium: "Medium", high: "High",
        xhigh: "Extra High", max: "Max", minimal: "Minimal",
      };

      globalThis.setupThinkingPicker = (ids, selectedId) => {
        const model = { id: "model" };
        const catalog = {
          models: [{ ref: model, label: "Sonnet", supportedThinkingOptionIds: ids }],
          defaultModel: model,
          thinkingOptions: ids.map((id) => ({ id, label: LABELS[id] })),
        };
        let view = {
          status: "ready",
          catalog,
          selected: model,
          selectedThinkingOptionId: selectedId,
          thinkingSelectionSupported: true,
        };
        globalThis.selections = [];
        let control;
        const render = () =>
          renderRendererThinkingOptionPicker(control, view, true, "claude-code", "en");
        control = mountRendererThinkingOptionPicker("test-composer", (id) => {
          globalThis.selections.push(id);
          view = { ...view, status: "selecting" };
          render();
          setTimeout(() => {
            view = { ...view, status: "ready", selectedThinkingOptionId: id };
            render();
          }, 150);
        });
        document.body.append(control.root);
        render();
      };
    `,
    resolveDir: repositoryRoot,
    sourcefile: "renderer-thinking-option-picker-e2e-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2024",
  write: false,
});

const browserBundle = outputFiles[0]?.text;
if (!browserBundle) throw new Error("Renderer Thinking picker E2E bundle was not generated");

const CLAUDE_CODE = ["off", "auto", "low", "medium", "high", "xhigh", "max"];

const setup = async (page: Page, ids: string[], selectedId: string): Promise<void> => {
  await page.setContent(
    '<!doctype html><body style="display:flex;align-items:flex-end;min-height:100vh;margin:0;padding-left:200px"></body>',
  );
  await page.addScriptTag({ content: browserBundle });
  await page.evaluate(
    ([optionIds, selected]) => {
      const setupPicker = Reflect.get(globalThis, "setupThinkingPicker");
      if (typeof setupPicker !== "function")
        throw new Error("Thinking picker setup is unavailable");
      setupPicker(optionIds, selected);
    },
    [ids, selectedId] as const,
  );
};

async function selections(page: Page): Promise<string[]> {
  return page.evaluate(() => Reflect.get(globalThis, "selections") as string[]);
}

async function railPoint(
  page: Page,
  index: number,
  count: number,
): Promise<{ x: number; y: number }> {
  const box = await page.locator("[data-codexhost-thinking-rail]").boundingBox();
  if (!box) throw new Error("Thinking rail geometry is unavailable");
  return { x: box.x + (box.width * index) / (count - 1), y: box.y + box.height / 2 };
}

test("dragging previews options and commits once on release", async ({ page }) => {
  await setup(page, CLAUDE_CODE, "high");
  const pill = page.locator('[data-codexhost-thinking-control="test-composer"] > button');
  const card = page.getByRole("dialog", { name: "Thinking" });
  const slider = card.getByRole("slider", { name: "Thinking" });

  await expect(pill).toHaveText("High");
  await expect(pill).toHaveAttribute("aria-label", "Thinking: High");
  await pill.click();
  await expect(card).toBeVisible();
  await expect(card).toContainText("Sonnet");
  await expect(slider).toBeFocused();
  await expect(slider).toHaveAttribute("aria-valuemax", "6");
  await expect(slider).toHaveAttribute("aria-valuenow", "4");
  await expect(slider).toHaveAttribute("aria-valuetext", "High");
  const [pillBox, cardBox] = await Promise.all([pill.boundingBox(), card.boundingBox()]);
  if (!pillBox || !cardBox) throw new Error("Thinking card geometry is unavailable");
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(pillBox.y + 1);
  expect(cardBox.x).toBeCloseTo(pillBox.x, 0);

  const start = await railPoint(page, 4, 7);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const low = await railPoint(page, 2, 7);
  await page.mouse.move(low.x, low.y, { steps: 4 });
  await expect(card).toContainText("Low");
  const max = await railPoint(page, 6, 7);
  await page.mouse.move(max.x, max.y, { steps: 4 });
  await expect(card).toContainText("Max");
  expect(await selections(page)).toEqual([]);
  await page.mouse.up();
  expect(await selections(page)).toEqual(["max"]);
  await expect(card).toBeVisible();
  await expect(slider).toHaveAttribute("aria-disabled", "true");
  await expect(pill).toBeDisabled();
  await expect(pill).toHaveText("Max");
  await expect(slider).toHaveAttribute("aria-disabled", "false");
  await expect(card).toBeVisible();

  await slider.press("ArrowLeft");
  expect(await selections(page)).toEqual(["max", "xhigh"]);
  await expect(pill).toHaveText("Extra High");
  await expect(slider).toHaveAttribute("aria-disabled", "false");

  const off = await railPoint(page, 0, 7);
  await page.mouse.click(off.x, off.y);
  expect(await selections(page)).toEqual(["max", "xhigh", "off"]);
  await expect(pill).toHaveText("Off");

  await page.mouse.click(off.x, off.y);
  expect(await selections(page)).toEqual(["max", "xhigh", "off"]);

  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await pill.click();
  await expect(card).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(card).toBeHidden();
});

test("a single option is shown read-only", async ({ page }) => {
  await setup(page, ["minimal"], "minimal");
  const pill = page.locator('[data-codexhost-thinking-control="test-composer"] > button');
  const card = page.getByRole("dialog", { name: "Thinking" });
  const slider = card.getByRole("slider");

  await expect(pill).toHaveText("Minimal");
  await pill.click();
  await expect(slider).toHaveAttribute("aria-readonly", "true");
  const point = await slider.boundingBox();
  if (!point) throw new Error("Thinking slider geometry is unavailable");
  await page.mouse.click(point.x + point.width - 4, point.y + point.height / 2);
  await slider.press("ArrowRight");
  expect(await selections(page)).toEqual([]);
});

test("a Model that supports only off hides the pill", async ({ page }) => {
  await setup(page, ["off"], "off");
  await expect(page.locator('[data-codexhost-thinking-control="test-composer"]')).toBeHidden();
});
