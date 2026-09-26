import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

import { tailwindEsbuildPlugin } from "../../packages/renderer-extension/scripts/tailwind-esbuild-plugin.mjs";

test.use({ timezoneId: "Asia/Shanghai" });
const browserExecutable = process.env.CODEXHOST_PLAYWRIGHT_EXECUTABLE_PATH;
if (browserExecutable) test.use({ launchOptions: { executablePath: browserExecutable } });

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { createAppearanceSettingsPage } from "./packages/renderer-extension/src/settings/appearance-page.ts";
      import { createRendererSettingsPageRegistry } from "./packages/renderer-extension/src/settings/core.ts";
      import { rendererSettingsMessages } from "./packages/renderer-extension/src/settings/localization.ts";
      import { mountRendererSettingsShell } from "./packages/renderer-extension/src/settings/shell.ts";
      import { createUsageSettingsPage } from "./packages/renderer-extension/src/settings/usage-page.ts";

      globalThis.setupUsage = ({ theme = "light" } = {}) => {
        document.documentElement.style.colorScheme = theme;
        const calls = [];
        const client = {
          async queryLocalUsage(params) {
            calls.push(params);
            return {
              range: { from: "2026-03-02", to: "2026-03-08" },
              totals: { total: 6035507564, input: 1200000, cacheRead: 5800000000, cacheWrite: 220000000, output: 14307564, reasoning: 0, conversations: 4331 },
              models: 4,
              harnesses: [
                { harnessId: "claude-code", name: "Claude Code", totalTokens: 5035507564, models: 3 },
                { harnessId: "pi", name: "Pi", totalTokens: 1000000000, models: 1 },
              ],
              daily: [
                { date: "2026-03-04", total: 1035507564, input: 200000, output: 4307564, cacheRead: 1000000000, reasoning: 0, conversations: 331 },
                { date: "2026-03-03", total: 5000000000, input: 1000000, output: 10000000, cacheRead: 4800000000, reasoning: 0, conversations: 4000 },
              ],
              stats: { last7Days: 6035507564, last30Days: 9035507564, dailyAverage: 752958964, activeDays: 128, firstActiveDate: "2025-06-01" },
            };
          },
        };
        globalThis.usageFixture = { calls };
        const messages = rendererSettingsMessages("zh-CN");
        const registry = createRendererSettingsPageRegistry([
          createAppearanceSettingsPage(messages),
          createUsageSettingsPage(messages, () => client),
        ]);
        const shell = mountRendererSettingsShell(registry, document, messages);
        shell.openSettings(undefined, "appearance");
        globalThis.usageFixture.open = (pageId) => shell.openSettings(undefined, pageId);
      };
    `,
    resolveDir: path.resolve(import.meta.dirname, "../.."),
    sourcefile: "settings-usage-e2e-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2024",
  loader: { ".css": "text", ".png": "dataurl", ".svg": "dataurl" },
  plugins: [tailwindEsbuildPlugin()],
  write: false,
});
const bundle = outputFiles[0]?.text ?? "";
if (!bundle) throw new Error("Usage settings fixture bundle missing");

async function setup(page: Page, options = {}) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route("http://localhost/usage-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await page.goto("http://localhost/usage-test");
  await page.addScriptTag({ content: bundle });
  await page.evaluate((options) => Reflect.get(globalThis, "setupUsage")(options), options);
}

test("expands the settings dialog for the usage page and shows the dashboard", async ({ page }) => {
  await setup(page);
  const dialog = page.locator("dialog.codexhost-settings-dialog");
  const defaultWidth = (await dialog.boundingBox())?.width ?? 0;
  await page.evaluate(() => Reflect.get(globalThis, "usageFixture").open("usage"));
  await expect(dialog).toHaveAttribute("data-size", "expanded");
  await expect.poll(async () => (await dialog.boundingBox())?.width ?? 0).toBe(1600 - 32);
  expect(defaultWidth).toBeLessThan(1600 - 32);

  await expect(page.locator("[data-usage-total]")).toHaveText("6.04B");
  await expect(page.locator("[data-usage-harness-card]")).toHaveCount(3);
  await expect(page.locator("[data-usage-day]")).toHaveCount(2);
  const segment = await page.locator('[data-usage-segment="claude-code"]').boundingBox();
  expect(segment?.height ?? 0).toBeGreaterThan(0);
  expect(await page.evaluate(() => Reflect.get(globalThis, "usageFixture").calls[0])).toEqual({
    period: { kind: "week" },
    timeZone: "Asia/Shanghai",
    refresh: true,
  });
  if (process.env.CODEXHOST_USAGE_SCREENSHOT_DIR) {
    await page.screenshot({
      path: path.join(process.env.CODEXHOST_USAGE_SCREENSHOT_DIR, "usage-light.png"),
    });
  }

  await page.evaluate(() => Reflect.get(globalThis, "usageFixture").open("appearance"));
  await expect(dialog).toHaveAttribute("data-size", "default");
});

test("stays readable in the dark theme and at a narrow window width", async ({ page }) => {
  await setup(page, { theme: "dark" });
  await page.evaluate(() => Reflect.get(globalThis, "usageFixture").open("usage"));
  await expect(page.locator("[data-usage-total]")).toHaveText("6.04B");
  if (process.env.CODEXHOST_USAGE_SCREENSHOT_DIR) {
    await page.screenshot({
      path: path.join(process.env.CODEXHOST_USAGE_SCREENSHOT_DIR, "usage-dark.png"),
    });
  }
  await page.setViewportSize({ width: 640, height: 900 });
  const overflow = await page.evaluate(() => {
    const shadow = document.querySelector("[data-codexhost-settings-shell]")?.shadowRoot;
    const content = shadow?.querySelector(".settings-page");
    return content ? content.scrollWidth - content.clientWidth : -1;
  });
  expect(overflow).toBe(0);
});
