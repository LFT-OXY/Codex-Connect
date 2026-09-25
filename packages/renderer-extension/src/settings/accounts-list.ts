import type { CodexAccountSummary, HarnessAccountListResult } from "@codexhost/shared-contracts";

import { KNOWN_RENDERER_AGENTS } from "../agent-selection-state.js";
import { createRendererAgentIcon } from "../renderer-agent-icon.js";
import { codexAccountDisplayName } from "../renderer-codex-account-options.js";
import {
  renderAccountResetCredits,
  renderAccountUsage,
  type AccountUsageDisplay,
  type AccountUsageViewState,
} from "./accounts-usage.js";
import type { RendererSettingsMessages } from "./localization.js";

export function accountPlanLabel(planType: CodexAccountSummary["planType"]): string | null {
  if (!planType || planType === "unknown") return null;
  if (planType === "free") return "Free";
  if (planType === "go") return "Go";
  if (planType === "plus") return "Plus";
  if (planType === "pro") return "Pro 20x";
  if (planType === "prolite") return "Pro 5x";
  if (planType === "team") return "Team";
  if (planType === "self_serve_business_prolite") return "Business Pro Lite";
  if (planType === "self_serve_business_usage_based") return "Business";
  if (planType === "business") return "Business";
  if (planType === "edu") return "Edu";
  if (planType === "edu_plus") return "Edu Plus";
  if (planType === "edu_pro") return "Edu Pro";
  return "Enterprise";
}

/** Preserve keyboard position when an async update replaces the Account groups. */
export function accountListFocusRestorer(list: HTMLElement, fallback: HTMLElement): () => void {
  const active = (list.getRootNode() as Document | ShadowRoot).activeElement;
  if (!active || !list.contains(active)) return () => undefined;
  const key = active.getAttribute("data-account-focus");
  const accountId = active.closest<HTMLElement>("[data-account-group]")?.dataset.accountId;
  return () => {
    const target = key
      ? list.querySelector<HTMLElement>(`[data-account-focus="${CSS.escape(key)}"]`)
      : null;
    if (target && !target.matches(":disabled")) {
      const dialog = target.closest("dialog");
      if (dialog && !dialog.open) dialog.showModal();
      target.focus({ preventScroll: true });
      return;
    }
    // An action may be disabled while pending or disappear after success.
    // Keep focus with its Account; use the page fallback only if that group is gone.
    const group = accountId
      ? list.querySelector<HTMLElement>(
          `[data-account-group][data-account-id="${CSS.escape(accountId)}"]`,
        )
      : null;
    (group ?? fallback).focus({ preventScroll: true });
  };
}

function createAccountPerson(
  document: Document,
  messages: RendererSettingsMessages,
  input: {
    name: string;
    agent: string;
    plan: string | null;
    highlighted?: boolean;
    active?: boolean;
    mark: HTMLElement;
  },
): HTMLElement {
  const person = document.createElement("div");
  person.className = "settings-account-row__person";
  const identity = document.createElement("div");
  identity.className = "settings-account-row__identity";
  const title = document.createElement("strong");
  title.className = "settings-account-email";
  title.textContent = input.name;
  title.title = input.name;
  title.translate = false;
  const metadata = document.createElement("div");
  metadata.className = "settings-account-metadata";
  const agent = document.createElement("span");
  agent.textContent = input.agent;
  agent.translate = false;
  if (input.name !== input.agent) metadata.append(agent);
  if (input.plan) {
    if (metadata.childElementCount) {
      const separator = document.createElement("span");
      separator.textContent = "·";
      separator.setAttribute("aria-hidden", "true");
      metadata.append(separator);
    }
    const plan = document.createElement("span");
    plan.className = input.highlighted
      ? "settings-account-plan settings-account-plan--highlighted"
      : "settings-account-plan";
    plan.textContent = input.plan;
    plan.translate = false;
    metadata.append(plan);
  }
  if (input.active) {
    const badge = document.createElement("span");
    badge.className = "settings-account-active";
    badge.textContent = messages.accountDefaultBadge;
    badge.title = messages.accountDefaultHint;
    metadata.append(badge);
  }
  identity.append(title);
  if (metadata.childElementCount) identity.append(metadata);
  person.append(input.mark, identity);
  return person;
}

const GROUP_CLASS =
  "grid gap-3 border-t border-settings-divider bg-settings-panel px-4 py-4 first:border-t-0";
const GROUP_HEADER_CLASS = "flex min-w-0 items-center gap-3";
// Windows align with the identity text, right of the 34px logo and its 11px gap.
const GROUP_BODY_CLASS = "grid gap-2.5 pl-[45px] @max-[28rem]:pl-0";

/** One Account per group: identity header with its optional Harness target mark, then limit bars. */
function createAccountGroup(
  document: Document,
  input: {
    name: string;
    person: HTMLElement;
    importAction?: HTMLElement | null | undefined;
    usage: HTMLElement;
    personTitle?: string;
  },
): { group: HTMLElement; body: HTMLElement } {
  const group = document.createElement("div");
  group.className = GROUP_CLASS;
  group.dataset.accountGroup = "";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", input.name);
  group.tabIndex = -1;
  const header = document.createElement("div");
  header.className = GROUP_HEADER_CLASS;
  const person = document.createElement("div");
  person.className = "min-w-0 flex-1";
  if (input.personTitle) person.title = input.personTitle;
  person.append(input.person);
  header.append(person);
  if (input.importAction) header.append(input.importAction);
  const body = document.createElement("div");
  body.className = GROUP_BODY_CLASS;
  body.append(input.usage);
  group.append(header, body);
  return { group, body };
}

export function renderAccountGroup(
  document: Document,
  account: CodexAccountSummary,
  messages: RendererSettingsMessages,
  input: {
    current: boolean;
    usage: AccountUsageViewState | undefined;
    display: AccountUsageDisplay;
    onRetry: () => void;
    importAction?: HTMLElement | null;
  },
): HTMLElement {
  const name = codexAccountDisplayName(account);
  const mark = document.createElement("div");
  mark.className = "settings-harness-account__logo";
  mark.dataset.agent = "codex";
  mark.setAttribute("aria-hidden", "true");
  mark.append(createRendererAgentIcon("codex", 26, document));
  // Codex Pro 20x shows only its generic weekly allowance so the Account has one comparable quota.
  const usage = renderAccountUsage(
    document,
    input.usage,
    messages,
    input.display,
    input.onRetry,
    account.planType === "pro" ? "weekly-only" : "all",
  );
  const { group, body } = createAccountGroup(document, {
    name: name.full,
    person: createAccountPerson(document, messages, {
      name: name.full,
      agent: "Codex",
      plan: accountPlanLabel(account.planType),
      highlighted: account.planType === "pro" || account.planType === "prolite",
      active: input.current,
      mark,
    }),
    importAction: input.importAction,
    usage,
  });
  group.dataset.accountId = account.accountId;
  group.dataset.accountFocus = `${account.accountId}:group`;
  const resetCredits =
    input.usage?.status === "ready"
      ? renderAccountResetCredits(document, input.usage.credits, messages)
      : null;
  if (resetCredits) body.append(resetCredits);
  return group;
}

export function renderHarnessAccountGroup(
  document: Document,
  account: HarnessAccountListResult["accounts"][number],
  messages: RendererSettingsMessages,
  display: AccountUsageDisplay,
  importAction?: HTMLElement | null,
): HTMLElement {
  const name = account.email ?? account.label ?? account.harnessName;
  const logo = document.createElement("div");
  logo.className = "settings-harness-account__logo";
  logo.setAttribute("aria-hidden", "true");
  const agent = KNOWN_RENDERER_AGENTS.find((agent) => agent === account.harnessId);
  if (agent) logo.append(createRendererAgentIcon(agent, 26, document));
  const { group } = createAccountGroup(document, {
    name,
    person: createAccountPerson(document, messages, {
      name,
      agent: account.harnessName,
      plan: account.plan ?? null,
      mark: logo,
    }),
    importAction,
    usage: renderAccountUsage(
      document,
      { status: "ready", credits: account.credits, freshness: "live", observedAt: null },
      messages,
      display,
      () => undefined,
    ),
    personTitle: messages.accountNativeManagementHint.replace("{harness}", account.harnessName),
  });
  group.dataset.harnessId = account.harnessId;
  return group;
}
