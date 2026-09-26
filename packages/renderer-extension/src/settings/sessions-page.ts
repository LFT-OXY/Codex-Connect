import {
  harnessPluginIdSchema,
  type HarnessSessionImportParams,
  type HarnessSessionImportResult,
  type HostThreadId,
  type LocalSession,
  type LocalSessionsQueryParams,
  type LocalSessionsQueryResult,
  type LocalSessionsView,
  type LocalUsageReading,
} from "@codexhost/shared-contracts";

import { RendererSessionImportUnavailableError } from "../renderer-session-import-client.js";
import { RendererMethodUnavailableError } from "../renderer-request-sender.js";
import type { RendererSettingsPageDefinition, RendererSettingsPageMountContext } from "./core.js";
import { createRendererSettingsIcon } from "./icons.js";
import type { RendererSettingsMessages } from "./localization.js";
import {
  SESSION_ACTION_CLASS,
  renderSessionRow,
  resumeButton,
  sessionColumnsHeader,
  sessionTitle,
} from "./sessions-list.js";
import { isWindowsRenderer } from "./renderer-platform.js";
import { sessionResumeCommand } from "./session-resume-command.js";
import { createSessionFilters, filterSessions } from "./sessions-filters.js";
import { usageBar } from "./usage-dashboard.js";
import { SETTINGS_BUTTON_CLASS } from "./control-classes.js";

/** Opens a Thread in Codex Desktop; the settings dialog closes once it has opened. */
export type RendererImportedThreadOpener = (
  threadId: HostThreadId,
  signal: AbortSignal,
) => Promise<void>;

export interface RendererSessionsClient {
  queryLocalSessions(input: LocalSessionsQueryParams): Promise<LocalSessionsQueryResult>;
  importHarnessSession(input: HarnessSessionImportParams): Promise<HarnessSessionImportResult>;
}

/** Delay before asking again while Host is still reading native records. */
const READING_POLL_MS = 500;
/** Rows added at a time, so thousands of Sessions do not render at once. */
const SESSION_BATCH = 200;

function sessionKey(session: LocalSession): string {
  return JSON.stringify([session.harnessId, session.nativeSessionId]);
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

/** Why Resume failed before a Thread existed, in the words the user can act on. */
function resumeFailure(error: unknown, messages: RendererSettingsMessages["sessions"]): string {
  if (error instanceof RendererSessionImportUnavailableError) return messages.resumeUnsupported;
  switch (errorCode(error)) {
    case -32079:
      return messages.resumeGone;
    case -32072:
      return messages.resumeBusy;
    default:
      return messages.resumeFailed;
  }
}

export function createSessionsSettingsPage(
  settingsMessages: RendererSettingsMessages,
  getClient: () => RendererSessionsClient | null,
  openThread: RendererImportedThreadOpener,
): RendererSettingsPageDefinition {
  const messages = settingsMessages.sessions;
  return Object.freeze({
    id: "sessions",
    label: settingsMessages.pageLabels.sessions,
    icon: "sessions",
    mount(context: RendererSettingsPageMountContext) {
      const document = context.content.ownerDocument;
      const shell = isWindowsRenderer(document.defaultView) ? "powershell" : "posix";
      const header = document.createElement("div");
      header.className = "flex items-center justify-between gap-4";
      const heading = document.createElement("h2");
      heading.className = "settings-section-label";
      heading.textContent = settingsMessages.pageLabels.sessions;
      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = SETTINGS_BUTTON_CLASS;
      refresh.dataset.sessionsAction = "refresh";
      header.append(heading, refresh);

      const description = document.createElement("p");
      description.className = "settings-page-description";
      description.textContent = messages.description;
      // Resume problems stay above the list while it refreshes underneath.
      const notice = document.createElement("div");
      notice.className = "mt-4 empty:hidden";
      const body = document.createElement("section");
      body.className = "mt-4";
      body.setAttribute("aria-live", "polite");
      const filters = createSessionFilters(document, messages, () => {
        shown = SESSION_BATCH;
        if (view) renderList(view);
      });
      context.content.append(header, description, notice, filters.root, body);

      let view: LocalSessionsView | null = null;
      let shown = SESSION_BATCH;
      let observer: IntersectionObserver | null = null;
      let loading = false;
      let showingProgress = false;
      let poll: ReturnType<typeof setTimeout> | undefined;
      /** The Session being resumed; one at a time. */
      let resuming: string | null = null;
      const resumeButtons = new Map<string, { button: HTMLButtonElement; session: LocalSession }>();
      context.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(poll);
          observer?.disconnect();
        },
        { once: true },
      );

      const renderControls = (): void => {
        refresh.disabled = loading || resuming !== null;
        refresh.replaceChildren(
          createRendererSettingsIcon("refresh", 15),
          loading ? messages.refreshing : messages.refresh,
        );
        for (const [key, { button, session }] of resumeButtons) {
          const available = session.threadId !== null || session.resumable;
          button.disabled = !available || session.running === true || resuming !== null;
          button.title = available ? "" : messages.resumeUnsupported;
          button.setAttribute("aria-busy", String(resuming === key));
          button.replaceChildren(
            createRendererSettingsIcon("external-link", 13),
            resuming === key ? messages.resuming : messages.resume,
          );
        }
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

      const renderView = (current: LocalSessionsView): void => {
        filters.update(current);
        renderList(current);
      };

      /** The filtered Sessions, a batch at a time; more are added as the list scrolls. */
      function renderList(current: LocalSessionsView): void {
        resumeButtons.clear();
        observer?.disconnect();
        const root = document.createElement("div");
        root.className = "flex flex-col gap-3";
        for (const { harnessId, name } of current.failures) {
          const failure = document.createElement("p");
          failure.className =
            "m-0 rounded-md border border-settings-border px-3 py-2 text-sm text-settings-danger";
          failure.dataset.sessionsFailure = harnessId;
          failure.setAttribute("role", "alert");
          failure.textContent = messages.sourceFailed.replace("{name}", name);
          root.append(failure);
        }
        const status = (message: string): void => {
          const empty = document.createElement("p");
          empty.className = "m-0 text-sm text-settings-muted";
          empty.setAttribute("role", "status");
          empty.textContent = message;
          root.append(empty);
          body.replaceChildren(root);
        };
        if (current.sessions.length === 0) {
          status(messages.empty);
          return;
        }
        const sessions = filterSessions(current.sessions, filters.filter(), Date.now());
        const summary = document.createElement("p");
        summary.className = "m-0 text-xs text-settings-muted";
        summary.dataset.sessionsSummary = "";
        summary.textContent = messages.summary
          .replace("{sessions}", sessions.length.toLocaleString())
          .replace(
            "{subagents}",
            sessions.reduce((sum, { subagents }) => sum + subagents, 0).toLocaleString(),
          );
        root.append(summary);
        if (sessions.length === 0) {
          status(messages.noMatches);
          return;
        }
        const list = document.createElement("div");
        list.setAttribute("role", "list");
        list.setAttribute("aria-label", messages.columnsLabel);
        list.dataset.sessionsList = "";
        const appendRows = (from: number, to: number): void => {
          for (const session of sessions.slice(from, to)) {
            const resume = resumeButton(document, messages);
            resume.addEventListener("click", () => void resumeSession(session));
            resumeButtons.set(sessionKey(session), { button: resume, session });
            const command = sessionResumeCommand(session, shell);
            const row = renderSessionRow(document, session, settingsMessages, [
              resume,
              ...(command ? [copyCommandButton(command)] : []),
            ]);
            row.setAttribute("role", "listitem");
            list.append(row);
          }
        };
        appendRows(0, shown);
        root.append(sessionColumnsHeader(document, messages), list);
        if (sessions.length > shown) {
          const more = document.createElement("button");
          more.type = "button";
          more.className = `${SESSION_ACTION_CLASS} self-center`;
          more.dataset.sessionsAction = "show-more";
          const label = (): void => {
            more.textContent = messages.showMore.replace(
              "{count}",
              (sessions.length - shown).toLocaleString(),
            );
          };
          label();
          // Rows are appended, not re-rendered, so the list keeps its scroll position.
          more.addEventListener("click", () => {
            appendRows(shown, shown + SESSION_BATCH);
            shown += SESSION_BATCH;
            renderControls();
            if (shown < sessions.length) {
              label();
              return;
            }
            observer?.disconnect();
            more.remove();
          });
          root.append(more);
          // Reaching the end of the list shows the next batch without a click.
          const Observer = document.defaultView?.IntersectionObserver;
          if (Observer) {
            observer = new Observer((entries) => {
              if (entries.some(({ isIntersecting }) => isIntersecting)) more.click();
            });
            observer.observe(more);
          }
        }
        body.replaceChildren(root);
        renderControls();
      }

      /** Copies `text`, briefly showing whether it worked in place of the label. */
      const copyButton = (
        text: string,
        action: string,
        labels: { idle: string; copied: string; failed: string },
      ): HTMLButtonElement => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = SESSION_ACTION_CLASS;
        button.dataset.sessionAction = action;
        const setLabel = (label: string): void => {
          button.replaceChildren(createRendererSettingsIcon("copy", 13), label);
        };
        const feedback = (label: string): void => {
          setLabel(label);
          document.defaultView?.setTimeout(() => setLabel(labels.idle), 2_000);
        };
        setLabel(labels.idle);
        button.addEventListener("click", () => {
          const clipboard = document.defaultView?.navigator.clipboard;
          if (!clipboard) {
            feedback(labels.failed);
            return;
          }
          void clipboard.writeText(text).then(
            () => feedback(labels.copied),
            () => feedback(labels.failed),
          );
        });
        return button;
      };

      const copyCommandButton = (command: string): HTMLButtonElement => {
        const button = copyButton(command, "copy-command", {
          idle: messages.copyCommand,
          copied: messages.commandCopied,
          failed: messages.commandCopyFailed,
        });
        button.title = command;
        return button;
      };

      /** What went wrong, the project path, and a way to try again. */
      const renderRecovery = (session: LocalSession, reason: string, opened: boolean): void => {
        const panel = document.createElement("section");
        panel.className =
          "flex flex-col gap-2 rounded-md border border-settings-border px-3 py-2.5 text-sm";
        panel.setAttribute("role", "alert");
        panel.dataset.sessionsRecovery = session.nativeSessionId;
        panel.tabIndex = -1;
        const title = document.createElement("strong");
        title.className = "font-medium";
        title.textContent = `${messages.resumeFailedTitle}: ${sessionTitle(session, messages)}`;
        const explanation = document.createElement("p");
        explanation.className = "m-0 text-settings-muted";
        explanation.textContent = reason;
        const actions = document.createElement("div");
        actions.className = "flex flex-wrap items-center gap-2";
        if (session.cwd) {
          const cwd = document.createElement("code");
          cwd.className = "min-w-0 truncate text-xs";
          cwd.textContent = session.cwd;
          cwd.title = session.cwd;
          actions.append(
            cwd,
            copyButton(session.cwd, "copy-project-path", {
              idle: messages.copyProjectPath,
              copied: messages.pathCopied,
              failed: messages.pathCopyFailed,
            }),
          );
        }
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = SESSION_ACTION_CLASS;
        retry.dataset.sessionAction = "retry-open";
        retry.append(
          createRendererSettingsIcon("refresh", 13),
          opened ? messages.retryOpen : messages.resume,
        );
        retry.addEventListener("click", () => void resumeSession(session));
        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.className = SESSION_ACTION_CLASS;
        dismiss.dataset.sessionAction = "dismiss";
        dismiss.textContent = messages.dismiss;
        dismiss.addEventListener("click", () => notice.replaceChildren());
        actions.append(retry, dismiss);
        panel.append(title, explanation, actions);
        notice.replaceChildren(panel);
        panel.focus();
      };

      /**
       * Opens the Session's Thread, first mapping the Session when it has none. Mapping only
       * records the Native Session; Host resumes it when the Thread opens.
       */
      async function resumeSession(session: LocalSession): Promise<void> {
        if (resuming !== null || context.signal.aborted) return;
        const client = getClient();
        if (!client) {
          renderRecovery(session, messages.unavailable, false);
          return;
        }
        const key = sessionKey(session);
        resuming = key;
        notice.replaceChildren();
        renderControls();
        const controller = new AbortController();
        const abort = (): void => controller.abort();
        context.signal.addEventListener("abort", abort, { once: true });
        let threadId: HostThreadId | null = session.threadId;
        try {
          if (threadId === null) {
            // Host gives every Session it can open without mapping, such as official Codex, a Thread.
            const harnessId = harnessPluginIdSchema.safeParse(session.harnessId);
            if (!harnessId.success) throw new RendererSessionImportUnavailableError();
            threadId = (
              await client.importHarnessSession({
                harnessId: harnessId.data,
                nativeSessionId: session.nativeSessionId,
              })
            ).threadId;
            // Later resumes open this Thread even before the list refreshes.
            session.threadId = threadId;
          }
          await openThread(threadId, controller.signal);
        } catch (error) {
          if (!controller.signal.aborted) {
            renderRecovery(
              session,
              threadId === null ? resumeFailure(error, messages) : messages.openFailed,
              threadId !== null,
            );
          }
        } finally {
          context.signal.removeEventListener("abort", abort);
          resuming = null;
          if (!context.signal.aborted) renderControls();
        }
      }

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
        if (!view && !showingProgress) renderStatus(messages.loading);
        return context.runLatest(() => client.queryLocalSessions({ refresh: refreshRecords }), {
          success(result) {
            if (result.status === "reading") {
              // The read continues in Host; ask again without starting another one.
              // A refresh keeps the listed Sessions on screen; the button shows it is reading.
              if (!view) {
                showingProgress = true;
                renderProgress(result.progress);
              }
              if (!context.signal.aborted) {
                poll = setTimeout(() => void load(false), READING_POLL_MS);
              }
              return;
            }
            loading = false;
            showingProgress = false;
            view = result;
            renderView(result);
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
        if (!loading && resuming === null) void load(true);
      });
      // Opening the page reads records added since the last visit.
      void load(true);
      return undefined;
    },
  });
}
