import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });

const { outputFiles } = await build({
  stdin: {
    contents: `
      import {
        mountRendererModelPicker,
        renderRendererModelPicker,
      } from "./packages/renderer-extension/src/renderer-model-picker.ts";

      globalThis.setupRendererModelPicker = () => {
        const modelA = { id: "model-a" };
        const modelB = { id: "model-b" };
        const catalog = {
          models: [
            {
              ref: modelA,
              label: "Provider / Model A",
              supportedThinkingOptionIds: ["off", "low"],
            },
            {
              ref: modelB,
              label: "Provider / Model B",
              supportedThinkingOptionIds: ["off", "high", "xhigh"],
            },
          ],
          defaultModel: modelA,
          thinkingOptions: [
            { id: "off", label: "Off" },
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
            { id: "xhigh", label: "Extra High" },
          ],
          defaultThinkingOptionId: "low",
        };
        let view = {
          status: "ready",
          catalog,
          selected: modelA,
          selectedThinkingOptionId: "low",
        };
        let control;
        control = mountRendererModelPicker("test-composer", (modelId) => {
          view = { ...view, status: "selecting" };
          renderRendererModelPicker(control, view, true);
          setTimeout(() => {
            view = {
              status: "ready",
              catalog,
              selected: modelId === modelB.id ? modelB : modelA,
              selectedThinkingOptionId: modelId === modelB.id ? "high" : "low",
            };
            renderRendererModelPicker(control, view, true);
          }, 250);
        });
        document.body.append(control.root);
        renderRendererModelPicker(control, view, true);
      };

      globalThis.setupClaudeRendererModelPicker = () => {
        const alias = { id: "claude-model-v1.alias" };
        const concrete = { id: "claude-model-v1.concrete" };
        const catalog = {
          models: [
            {
              ref: alias,
              label: "Family alias",
              resolvedModelLabel: "Runtime custom",
              supportedThinkingOptionIds: ["low", "high"],
            },
            {
              ref: concrete,
              label: "Runtime custom",
              resolvedModelLabel: "Runtime custom",
            },
          ],
          defaultModel: alias,
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
        };
        const view = {
          status: "ready",
          catalog,
          selected: alias,
          resolvedModelLabel: "Runtime custom",
          thinkingSelectionSupported: false,
        };
        const control = mountRendererModelPicker("claude-composer", () => {});
        document.body.append(control.root);
        renderRendererModelPicker(control, view, true);
      };
    `,
    resolveDir: repositoryRoot,
    sourcefile: "renderer-model-picker-e2e-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2024",
  write: false,
});

const browserBundle = outputFiles[0]?.text;
if (!browserBundle) throw new Error("Renderer Model picker E2E bundle was not generated");

test("the Model pill opens the Model list directly and closes it after selection", async ({
  page,
}) => {
  await page.setContent(
    '<!doctype html><body style="display:flex;align-items:flex-end;min-height:100vh;margin:0"></body>',
  );
  await page.addScriptTag({ content: browserBundle });
  await page.evaluate(() => {
    const setup = Reflect.get(globalThis, "setupRendererModelPicker");
    if (typeof setup !== "function") throw new Error("Model picker setup is unavailable");
    setup();
  });

  const root = page.locator('[data-codexhost-model-control="test-composer"]');
  const trigger = root.locator(':scope > button[aria-haspopup="menu"]');
  const modelMenu = page.getByRole("menu", { name: "Model", exact: true });

  await expect(trigger).toHaveText("Provider / Model A");
  await trigger.click();
  await expect(modelMenu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(modelMenu.getByRole("searchbox")).toBeVisible();
  await expect(page.locator("button[data-thinking-option-id]")).toHaveCount(0);
  const [triggerBox, modelBox] = await Promise.all([
    trigger.boundingBox(),
    modelMenu.boundingBox(),
  ]);
  if (!triggerBox || !modelBox) throw new Error("Model list geometry is unavailable");
  expect(modelBox.y + modelBox.height).toBeLessThanOrEqual(triggerBox.y + 1);
  expect(modelBox.height).toBeLessThanOrEqual(360);

  await modelMenu.locator('button[data-model-id="model-b"]').click();
  await expect(modelMenu).toBeHidden();
  await expect(trigger).toBeDisabled();
  await expect(trigger).toBeEnabled();
  await expect(trigger).toHaveText("Provider / Model B");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("Claude aliases show the actual runtime Model as secondary text", async ({ page }) => {
  await page.setContent(
    '<!doctype html><body style="display:flex;align-items:flex-end;min-height:100vh;margin:0"></body>',
  );
  await page.addScriptTag({ content: browserBundle });
  await page.evaluate(() => {
    const setup = Reflect.get(globalThis, "setupClaudeRendererModelPicker");
    if (typeof setup !== "function") throw new Error("Claude Model picker setup is unavailable");
    setup();
  });

  const root = page.locator('[data-codexhost-model-control="claude-composer"]');
  const trigger = root.locator(':scope > button[aria-haspopup="menu"]');
  await expect(trigger).toContainText("Family alias");
  await expect(trigger).toContainText("Runtime custom");
  await expect(trigger).toHaveAttribute("aria-label", /Family alias, Runtime custom/u);
  const secondaryLabel = trigger.locator("span").last();
  const [labelTriggerBox, secondaryLabelBox] = await Promise.all([
    trigger.boundingBox(),
    secondaryLabel.boundingBox(),
  ]);
  if (!labelTriggerBox || !secondaryLabelBox)
    throw new Error("Model trigger geometry is unavailable");
  const trailingSpace =
    labelTriggerBox.x + labelTriggerBox.width - (secondaryLabelBox.x + secondaryLabelBox.width);
  expect(trailingSpace).toBeLessThanOrEqual(16);

  await trigger.click();
  const modelMenu = page.getByRole("menu", { name: "Model", exact: true });
  await expect(modelMenu.locator("button[data-model-id]")).toHaveCount(2);
  const [claudeTriggerBox, modelBox, viewport] = await Promise.all([
    trigger.boundingBox(),
    modelMenu.boundingBox(),
    page.evaluate(() => ({ height: window.innerHeight, width: window.innerWidth })),
  ]);
  if (!claudeTriggerBox || !modelBox) throw new Error("Model list geometry is unavailable");
  expect(modelBox.y + modelBox.height).toBeLessThanOrEqual(claudeTriggerBox.y + 1);
  expect(modelBox.x).toBeGreaterThanOrEqual(8);
  expect(modelBox.x + modelBox.width).toBeLessThanOrEqual(viewport.width - 8);
  await expect(root).not.toContainText("claude-model-v1");
});
