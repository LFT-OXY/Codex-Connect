---
name: atw-init-repo
description: "为当前代码库配置工程技能所依赖的三样东西：问题跟踪器、分诊标签词汇、领域文档布局，写入 docs/agents/。首次使用 atw-spec / atw-tickets / atw-triage / atw-map / atw-code-review 之前跑一次。"
disable-model-invocation: true
---

# Init repo

Scaffold the per-repo configuration the engineering skills assume:

- **Issue tracker** — where issues live for this repo
- **Triage labels** — the strings used for the five canonical triage roles
- **Domain docs** — where `CONTEXT.md` and ADRs live, and the rules for reading them

The output is three files under `docs/agents/`, plus an `## Agent skills` block in the repo's agent instructions file. Five skills read them: `atw-spec`, `atw-tickets`, `atw-triage`, `atw-map`, `atw-code-review`. `atw-research` reads the tracker doc for where findings go.

This is a prompt-driven skill, not a deterministic script. Explore, present what you found, confirm with the user, then write.

## Process

### 1. Explore

Look at the current repo to understand its starting state. Read whatever exists; don't assume:

- `git remote -v` — is this a GitHub repo? GitLab? No remote at all?
- `CLAUDE.md` and `AGENTS.md` at the repo root — does either exist? Is there already an `## Agent skills` section in either?
- `CONTEXT.md` and `CONTEXT-MAP.md` at the repo root
- `docs/adr/` and any `src/*/docs/adr/` directories
- `docs/agents/` — does this skill's prior output already exist?
- `.scratch/` — sign that a local-markdown issue tracker convention is already in use
- `.atw/scripts/tickets.py` — the ATW ticket parser. Its presence means this repo can use its own task directory as the tracker, which is usually the right answer
- Monorepo signals — a `pnpm-workspace.yaml`, a `workspaces` field in `package.json`, or a populated `packages/*` with its own `src/`. Present only in a genuinely large multi-package repo; their absence means single-context, which is almost every repo.

### 2. Present findings and ask

Summarise what's present and what's missing. Then take the sections in order — one section, one answer, then the next.

Lead each section with the recommended answer so the user can accept it in a word. Give a one-line explainer only when the choice genuinely branches; skip Section C entirely when there's no monorepo.

**Section A — Issue tracker.**

> Explainer: The "issue tracker" is where issues live for this repo. Skills like `atw-tickets`, `atw-triage`, and `atw-spec` read from and write to it — they need to know whether to call `gh issue create`, write a markdown file under the task directory, or follow some other workflow you describe. Pick the place you actually track work for this repo.

Default posture: if `.atw/scripts/tickets.py` is present, propose the ATW task directory. **Which of the two ATW variants you propose is decided by `git remote get-url origin`**: a GitHub remote → the mirrored variant; no remote, or a non-GitHub one → **ATW task directory (local only)**. Don't propose the mirror to a repo that has nothing to mirror to — `github_sync.py` would sit there printing "本仓库没有 GitHub 远程，跳过 Issue 创建" on every task, and would silently start filing real issues the day someone adds a remote. Otherwise, if a `git remote` points at GitHub, propose that; if it points at GitLab (`gitlab.com` or a self-hosted host), propose GitLab. Offer:

- **ATW task directory + GitHub** — the spec and tickets for the current task live in `.atw/tasks/<task>/` and sync one-way out to GitHub Issues; issues other people raise stay in GitHub Issues
- **ATW task directory (local only)** — same task directory, **no remote mirror at all**: nothing is synced, and no GitHub Issue is created. Propose this one when the repo has no `git remote` (also valid for a solo/private repo, or a team that deliberately keeps planning artifacts out of the issue tracker)
- **GitHub** — issues live in the repo's GitHub Issues (uses the `gh` CLI)
- **GitLab** — issues live in the repo's GitLab Issues (uses the [`glab`](https://gitlab.com/gitlab-org/cli) CLI)
- **Local markdown** — issues live as files under `.scratch/<feature>/` in this repo (good for repos that don't run the ATW task system)
- **Other** (Jira, Linear, etc.) — ask the user to describe the workflow in one paragraph; the skill will record it as freeform prose

Record the choice in `docs/agents/issue-tracker.md`. The GitHub and GitLab templates carry a "PRs as a request surface" flag, defaulted **off** — leave it off and don't raise it; a user who wants external PRs in the triage queue can flip the flag in the file later.

**Section B — Triage label vocabulary.** `atw-triage` ships with every ATW install, so this section always runs. Ask exactly one question:

> Do you want to keep the default triage labels? (recommended: **yes**)

The defaults are the five canonical roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. On **yes**, write them as-is. Only if the user says no — usually because their tracker already uses other names (e.g. `bug:triage` for `needs-triage`) — collect the overrides so `atw-triage` applies existing labels instead of creating duplicates.

**Section C — Domain docs.** Default to **single-context** — one `CONTEXT.md` + `docs/adr/` at the repo root. This fits almost every repo; write it without asking.

Offer **multi-context** — a root `CONTEXT-MAP.md` pointing to per-context `CONTEXT.md` files — only when exploration found monorepo signals. Then confirm which layout they want.

### 3. Confirm and edit

Show the user a draft of:

- The `## Agent skills` block to add to whichever of `CLAUDE.md` / `AGENTS.md` is being edited (see step 4 for selection rules)
- The contents of `docs/agents/issue-tracker.md`, `docs/agents/domain.md`, and `docs/agents/triage-labels.md`

Let them edit before writing.

### 4. Write

**Pick the file to edit:**

- If `CLAUDE.md` exists, edit it.
- Else if `AGENTS.md` exists, edit it.
- If neither exists, ask the user which one to create — don't pick for them.

Never create `AGENTS.md` when `CLAUDE.md` already exists (or vice versa) — always edit the one that's already there.

If an `## Agent skills` block already exists in the chosen file, update its contents in-place rather than appending a duplicate. Don't overwrite user edits to the surrounding sections.

The block:

```markdown
## Agent skills

### Issue tracker

[one-line summary of where issues are tracked]. See `docs/agents/issue-tracker.md`.

### Triage labels

[one-line summary of the label vocabulary]. See `docs/agents/triage-labels.md`.

### Domain docs

[one-line summary of layout — "single-context" or "multi-context"]. See `docs/agents/domain.md`.
```

Then write the docs files using the seed templates in this skill's `references/` directory as a starting point:

- [issue-tracker-atw.md](./references/issue-tracker-atw.md) — ATW task directory + GitHub mirror
- [issue-tracker-atw-local.md](./references/issue-tracker-atw-local.md) — ATW task directory, no mirror. Also carries a `## Re-enabling the GitHub mirror` section, so picking it is reversible
- [issue-tracker-github.md](./references/issue-tracker-github.md) — GitHub issue tracker
- [issue-tracker-gitlab.md](./references/issue-tracker-gitlab.md) — GitLab issue tracker
- [issue-tracker-local.md](./references/issue-tracker-local.md) — local-markdown issue tracker
- [triage-labels.md](./references/triage-labels.md) — label mapping
- [domain.md](./references/domain.md) — domain doc consumer rules + layout

For "other" issue trackers, write `docs/agents/issue-tracker.md` from scratch using the user's description. It still needs the two lookup headings below, or the skills that read it will find nothing.

**Keep every `##` heading verbatim from the template — do not translate them.** The prose under a heading may be written in whatever language the user works in, but the headings themselves are lookup keys that other skills match on literally:

| Skill | Heading it looks for |
|---|---|
| `atw-map` | `## Wayfinding operations` |
| `atw-tickets` | `## When a skill says "publish to the issue tracker"` |
| `atw-code-review` | `## When a skill says "publish to the issue tracker"` |

A translated heading fails **silently**: `atw-map` says "if no tracker has been provided, default to the local-markdown tracker", so it quietly falls back to writing under `.scratch/` instead of reporting an error. This has been observed in practice in a Chinese-language session, where all eight headings were translated.

The same rule covers everything else other tooling matches literally: `[workflow-state:*]` tag names, task status values, file names, command names, and skill names all stay in English.

### 5. Done

Tell the user the setup is complete and which engineering skills will now read from these files. Mention they can edit `docs/agents/*.md` directly later — re-running this skill is only necessary if they want to switch issue trackers or restart from scratch.
