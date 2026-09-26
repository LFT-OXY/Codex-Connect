import {
  localUsagePeriodSchema,
  type LocalUsagePeriod,
  type LocalUsageQueryParams,
  type LocalUsageQueryResult,
  type LocalUsageReading,
  type LocalUsageView,
} from "@codexhost/shared-contracts";

import { RendererMethodUnavailableError } from "../renderer-request-sender.js";
import type { RendererSettingsPageDefinition, RendererSettingsPageMountContext } from "./core.js";
import { createRendererSettingsIcon } from "./icons.js";
import type { RendererSettingsMessages } from "./localization.js";
import { renderLocalUsage, usageBar, type UsageDetailTab } from "./usage-dashboard.js";

export interface RendererUsageClient {
  queryLocalUsage(input: LocalUsageQueryParams): Promise<LocalUsageQueryResult>;
}

type PeriodKind = LocalUsagePeriod["kind"];
const PERIOD_KINDS = ["day", "week", "month", "total", "custom"] as const satisfies PeriodKind[];
/** Delay before asking again while Host is still reading native records. */
const READING_POLL_MS = 500;

function periodLabel(kind: PeriodKind, messages: RendererSettingsMessages["usage"]): string {
  switch (kind) {
    case "day":
      return messages.periodDay;
    case "week":
      return messages.periodWeek;
    case "month":
      return messages.periodMonth;
    case "total":
      return messages.periodTotal;
    case "custom":
      return messages.periodCustom;
  }
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const BUTTON_CLASS = [
  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px]",
  "border border-settings-border bg-settings-surface text-settings-text",
  "transition-colors hover:bg-settings-surface-hover disabled:cursor-default disabled:opacity-60",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-settings-focus",
].join(" ");
const SEGMENT_CLASS = [
  "h-7 rounded-md border-0 px-3 text-[13px]",
  "bg-transparent text-settings-muted",
  "transition-colors hover:text-settings-text focus-visible:outline-2 focus-visible:outline-settings-focus",
  "aria-pressed:bg-settings-panel aria-pressed:font-medium aria-pressed:text-settings-text",
  "aria-pressed:shadow-[0_1px_2px_rgb(0_0_0/0.12)]",
].join(" ");
const DATE_CLASS =
  "h-8 rounded-md border border-settings-border bg-settings-surface px-2 text-[13px] text-settings-text";

export function createUsageSettingsPage(
  settingsMessages: RendererSettingsMessages,
  getClient: () => RendererUsageClient | null,
): RendererSettingsPageDefinition {
  const messages = settingsMessages.usage;
  return Object.freeze({
    id: "usage",
    label: settingsMessages.pageLabels.usage,
    icon: "usage",
    mount(context: RendererSettingsPageMountContext) {
      const document = context.content.ownerDocument;
      const header = document.createElement("div");
      header.className = "flex items-center justify-between gap-4";
      const heading = document.createElement("h2");
      heading.className = "settings-section-label";
      heading.textContent = settingsMessages.pageLabels.usage;
      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = BUTTON_CLASS;
      refresh.dataset.usageAction = "refresh";
      header.append(heading, refresh);

      const description = document.createElement("p");
      description.className = "settings-page-description";
      description.textContent = messages.description;

      const controls = document.createElement("div");
      controls.className = "mt-4 flex flex-wrap items-center gap-3";
      const periods = document.createElement("div");
      periods.className = "inline-flex gap-0.5 rounded-lg bg-settings-surface p-0.5";
      periods.setAttribute("role", "group");
      periods.setAttribute("aria-label", messages.periodsLabel);
      const periodButtons = new Map<PeriodKind, HTMLButtonElement>();
      for (const kind of PERIOD_KINDS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = SEGMENT_CLASS;
        button.dataset.usagePeriod = kind;
        button.textContent = periodLabel(kind, messages);
        button.addEventListener("click", () => selectPeriod(kind));
        periodButtons.set(kind, button);
        periods.append(button);
      }

      const custom = document.createElement("form");
      custom.className = "flex flex-wrap items-center gap-2";
      custom.dataset.usageCustom = "";
      custom.hidden = true;
      const dateField = (label: string): HTMLInputElement => {
        const wrapper = document.createElement("label");
        wrapper.className = "flex items-center gap-1.5 text-xs text-settings-muted";
        const input = document.createElement("input");
        input.type = "date";
        input.className = DATE_CLASS;
        wrapper.append(label, input);
        custom.append(wrapper);
        return input;
      };
      const from = dateField(messages.customFrom);
      const to = dateField(messages.customTo);
      from.dataset.usageCustomFrom = "";
      to.dataset.usageCustomTo = "";
      const apply = document.createElement("button");
      apply.type = "submit";
      apply.className = BUTTON_CLASS;
      apply.textContent = messages.customApply;
      const customError = document.createElement("span");
      customError.className = "text-xs text-settings-danger";
      customError.setAttribute("role", "alert");
      customError.hidden = true;
      custom.append(apply, customError);
      custom.addEventListener("submit", (event) => {
        event.preventDefault();
        const parsed = localUsagePeriodSchema.safeParse({
          kind: "custom",
          from: from.value,
          to: to.value,
        });
        customError.hidden = parsed.success;
        customError.textContent = parsed.success ? "" : messages.customInvalid;
        if (!parsed.success) return;
        period = parsed.data;
        void load(false);
      });
      controls.append(periods, custom);

      const body = document.createElement("section");
      body.className = "mt-6";
      body.setAttribute("aria-live", "polite");
      context.content.append(header, description, controls, body);

      let period: LocalUsagePeriod = { kind: "week" };
      let selectedKind: PeriodKind = "week";
      let lastRange: LocalUsageView["range"] | null = null;
      let loading = false;
      let detailTab: UsageDetailTab = "daily";
      let showingProgress = false;
      let poll: ReturnType<typeof setTimeout> | undefined;
      // Closing settings disposes the page and stops asking for read progress.
      context.signal.addEventListener("abort", () => clearTimeout(poll), { once: true });

      const renderControls = (): void => {
        for (const [kind, button] of periodButtons) {
          button.setAttribute("aria-pressed", String(kind === selectedKind));
        }
        custom.hidden = selectedKind !== "custom";
        refresh.disabled = loading;
        refresh.replaceChildren(
          createRendererSettingsIcon("refresh", 15),
          loading ? messages.refreshing : messages.refresh,
        );
      };
      const renderStatus = (message: string, error = false): void => {
        const status = document.createElement("p");
        status.className = error
          ? "m-0 text-sm text-settings-danger"
          : "m-0 text-sm text-settings-muted";
        status.setAttribute("role", error ? "alert" : "status");
        status.textContent = message;
        body.replaceChildren(status);
      };

      function selectPeriod(kind: PeriodKind): void {
        if (kind === selectedKind) return;
        selectedKind = kind;
        if (kind === "custom") {
          // Start from the range on screen; the query waits for Apply.
          from.value = lastRange?.from ?? "";
          to.value = lastRange?.to ?? "";
          customError.hidden = true;
          renderControls();
          return;
        }
        period = { kind };
        void load(false);
      }

      const renderProgress = (progress: LocalUsageReading["progress"]): void => {
        renderStatus(
          progress.total > 0
            ? messages.loadingProgress
                .replace("{processed}", progress.processed.toLocaleString())
                .replace("{total}", progress.total.toLocaleString())
            : messages.loading,
        );
        if (progress.total === 0) return;
        const meter = usageBar(
          document,
          (progress.processed / progress.total) * 100,
          "mt-3 h-1.5 w-full max-w-md",
        );
        meter.setAttribute("role", "progressbar");
        meter.setAttribute("aria-label", messages.loading);
        meter.setAttribute("aria-valuemin", "0");
        meter.setAttribute("aria-valuemax", String(progress.total));
        meter.setAttribute("aria-valuenow", String(progress.processed));
        body.append(meter);
      };

      const load = (refreshRecords: boolean): Promise<void> => {
        clearTimeout(poll);
        const client = getClient();
        if (!client) {
          renderStatus(messages.unavailable);
          renderControls();
          return Promise.resolve();
        }
        loading = true;
        renderControls();
        if (!lastRange && !showingProgress) renderStatus(messages.loading);
        const params: LocalUsageQueryParams = {
          period,
          timeZone: localTimeZone(),
          refresh: refreshRecords,
        };
        return context.runLatest(() => client.queryLocalUsage(params), {
          success(result) {
            if (result.status === "reading") {
              // The read continues in Host; ask again without starting another one.
              showingProgress = true;
              renderProgress(result.progress);
              if (!context.signal.aborted) {
                poll = setTimeout(() => void load(false), READING_POLL_MS);
              }
              return;
            }
            loading = false;
            showingProgress = false;
            lastRange = result.range;
            body.replaceChildren(
              renderLocalUsage(document, result, settingsMessages, {
                selected: detailTab,
                select(tab) {
                  detailTab = tab;
                },
              }),
            );
            renderControls();
          },
          failure(error) {
            loading = false;
            showingProgress = false;
            renderStatus(
              error instanceof RendererMethodUnavailableError
                ? messages.unavailable
                : messages.failed,
              !(error instanceof RendererMethodUnavailableError),
            );
            renderControls();
          },
        });
      };

      refresh.addEventListener("click", () => {
        if (!loading) void load(true);
      });
      // Opening the page reads records added since the last visit.
      void load(true);
      return undefined;
    },
  });
}
