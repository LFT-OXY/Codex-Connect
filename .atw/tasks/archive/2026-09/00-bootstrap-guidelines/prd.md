# Bootstrap Task: Fill Project Development Guidelines

**You (the AI) are running this task. The developer does not read this file.**

The developer just ran `atw init` on this project for the first time.
`.atw/` now exists with empty spec scaffolding, and this bootstrap task
exists under `.atw/tasks/`. When they want to work on it, they should start
this task from a session that provides ATW session identity.

**Your job**: help them populate `.atw/spec/` with the team's real
coding conventions. Every future AI session — the `/atw-implement` run
and this project's `atw-review` sub-agents — reads spec files
listed in per-task jsonl manifests. Empty spec = the AI writes generic
code. Real spec = the AI matches the team's actual patterns.

Don't dump instructions. Open with a short greeting, figure out if the repo
has any existing convention docs (CLAUDE.md, .cursorrules, etc.), and drive
the rest conversationally.

---

## Status (update the checkboxes as you complete each item)

- [x] Fill guidelines for adapters
- [x] Fill guidelines for @codexhost/desktop-control
- [x] Fill guidelines for @codexhost/harness-adapter
- [x] Fill guidelines for @codexhost/harness-broker
- [x] Fill guidelines for @codexhost/harness-discovery
- [x] Fill guidelines for @codexhost/host-runtime
- [x] Fill guidelines for @codexhost/mapping-store
- [x] Fill guidelines for @codexhost/protocol-core
- [x] Fill guidelines for @codexhost/renderer-extension
- [x] Fill guidelines for @codexhost/repository-automation
- [x] Fill guidelines for @codexhost/shared-contracts
- [x] Fill guidelines for @codexhost/update-manager
- [x] Fill guidelines for @codexhost/adapter-antigravity
- [x] Fill guidelines for @codexhost/adapter-claude-code
- [x] Fill guidelines for @codexhost/adapter-codebuddy
- [x] Fill guidelines for @codexhost/adapter-cursor-cli
- [x] Fill guidelines for @codexhost/adapter-deepseek-harness
- [x] Fill guidelines for @codexhost/adapter-grok
- [x] Fill guidelines for @codexhost/adapter-hermes
- [x] Fill guidelines for @codexhost/adapter-kimi-code
- [x] Fill guidelines for @codexhost/adapter-kiro-cli
- [x] Fill guidelines for @codexhost/adapter-omp
- [x] Fill guidelines for @codexhost/adapter-opencode
- [x] Fill guidelines for @codexhost/adapter-pi
- [x] Fill guidelines for @codexhost/adapter-qoder
- [x] Fill guidelines for @codexhost/adapter-qoder-cn
- [x] Fill guidelines for @codexhost/adapter-workbuddy
- [x] Fill guidelines for codexhost-launcher
- [x] Fill guidelines for codexhost-platform
- [x] Fill guidelines for codexhost-shim
- [x] Fill guidelines for codexhost-updater
- [x] Fill guidelines for codexhost-gate-a-native
- [x] Add code examples

---

## Spec files to populate

### Package: adapters (`spec/adapters/`)

- Backend guidelines: `.atw/spec/adapters/backend/`

- Frontend guidelines: `.atw/spec/adapters/frontend/`

### Package: @codexhost/desktop-control (`spec/desktop-control/`)

- Backend guidelines: `.atw/spec/desktop-control/backend/`

- Frontend guidelines: `.atw/spec/desktop-control/frontend/`

### Package: @codexhost/harness-adapter (`spec/harness-adapter/`)

- Backend guidelines: `.atw/spec/harness-adapter/backend/`

- Frontend guidelines: `.atw/spec/harness-adapter/frontend/`

### Package: @codexhost/harness-broker (`spec/harness-broker/`)

- Backend guidelines: `.atw/spec/harness-broker/backend/`

- Frontend guidelines: `.atw/spec/harness-broker/frontend/`

### Package: @codexhost/harness-discovery (`spec/harness-discovery/`)

- Backend guidelines: `.atw/spec/harness-discovery/backend/`

- Frontend guidelines: `.atw/spec/harness-discovery/frontend/`

### Package: @codexhost/host-runtime (`spec/host-runtime/`)

- Backend guidelines: `.atw/spec/host-runtime/backend/`

- Frontend guidelines: `.atw/spec/host-runtime/frontend/`

### Package: @codexhost/mapping-store (`spec/mapping-store/`)

- Backend guidelines: `.atw/spec/mapping-store/backend/`

- Frontend guidelines: `.atw/spec/mapping-store/frontend/`

### Package: @codexhost/protocol-core (`spec/protocol-core/`)

- Backend guidelines: `.atw/spec/protocol-core/backend/`

- Frontend guidelines: `.atw/spec/protocol-core/frontend/`

### Package: @codexhost/renderer-extension (`spec/renderer-extension/`)

- Backend guidelines: `.atw/spec/renderer-extension/backend/`

- Frontend guidelines: `.atw/spec/renderer-extension/frontend/`

### Package: @codexhost/repository-automation (`spec/repository-automation/`)

- Frontend guidelines: `.atw/spec/repository-automation/frontend/`

### Package: @codexhost/shared-contracts (`spec/shared-contracts/`)

- Backend guidelines: `.atw/spec/shared-contracts/backend/`

- Frontend guidelines: `.atw/spec/shared-contracts/frontend/`

### Package: @codexhost/update-manager (`spec/update-manager/`)

- Backend guidelines: `.atw/spec/update-manager/backend/`

- Frontend guidelines: `.atw/spec/update-manager/frontend/`

### Package: @codexhost/adapter-antigravity (`spec/adapter-antigravity/`)

- Backend guidelines: `.atw/spec/adapter-antigravity/backend/`

- Frontend guidelines: `.atw/spec/adapter-antigravity/frontend/`

### Package: @codexhost/adapter-claude-code (`spec/adapter-claude-code/`)

- Backend guidelines: `.atw/spec/adapter-claude-code/backend/`

- Frontend guidelines: `.atw/spec/adapter-claude-code/frontend/`

### Package: @codexhost/adapter-codebuddy (`spec/adapter-codebuddy/`)

- Backend guidelines: `.atw/spec/adapter-codebuddy/backend/`

- Frontend guidelines: `.atw/spec/adapter-codebuddy/frontend/`

### Package: @codexhost/adapter-cursor-cli (`spec/adapter-cursor-cli/`)

- Backend guidelines: `.atw/spec/adapter-cursor-cli/backend/`

- Frontend guidelines: `.atw/spec/adapter-cursor-cli/frontend/`

### Package: @codexhost/adapter-deepseek-harness (`spec/adapter-deepseek-harness/`)

- Backend guidelines: `.atw/spec/adapter-deepseek-harness/backend/`

- Frontend guidelines: `.atw/spec/adapter-deepseek-harness/frontend/`

### Package: @codexhost/adapter-grok (`spec/adapter-grok/`)

- Backend guidelines: `.atw/spec/adapter-grok/backend/`

- Frontend guidelines: `.atw/spec/adapter-grok/frontend/`

### Package: @codexhost/adapter-hermes (`spec/adapter-hermes/`)

- Backend guidelines: `.atw/spec/adapter-hermes/backend/`

- Frontend guidelines: `.atw/spec/adapter-hermes/frontend/`

### Package: @codexhost/adapter-kimi-code (`spec/adapter-kimi-code/`)

- Backend guidelines: `.atw/spec/adapter-kimi-code/backend/`

- Frontend guidelines: `.atw/spec/adapter-kimi-code/frontend/`

### Package: @codexhost/adapter-kiro-cli (`spec/adapter-kiro-cli/`)

- Backend guidelines: `.atw/spec/adapter-kiro-cli/backend/`

- Frontend guidelines: `.atw/spec/adapter-kiro-cli/frontend/`

### Package: @codexhost/adapter-omp (`spec/adapter-omp/`)

- Backend guidelines: `.atw/spec/adapter-omp/backend/`

- Frontend guidelines: `.atw/spec/adapter-omp/frontend/`

### Package: @codexhost/adapter-opencode (`spec/adapter-opencode/`)

- Backend guidelines: `.atw/spec/adapter-opencode/backend/`

- Frontend guidelines: `.atw/spec/adapter-opencode/frontend/`

### Package: @codexhost/adapter-pi (`spec/adapter-pi/`)

- Backend guidelines: `.atw/spec/adapter-pi/backend/`

- Frontend guidelines: `.atw/spec/adapter-pi/frontend/`

### Package: @codexhost/adapter-qoder (`spec/adapter-qoder/`)

- Backend guidelines: `.atw/spec/adapter-qoder/backend/`

- Frontend guidelines: `.atw/spec/adapter-qoder/frontend/`

### Package: @codexhost/adapter-qoder-cn (`spec/adapter-qoder-cn/`)

- Frontend guidelines: `.atw/spec/adapter-qoder-cn/frontend/`

### Package: @codexhost/adapter-workbuddy (`spec/adapter-workbuddy/`)

- Backend guidelines: `.atw/spec/adapter-workbuddy/backend/`

- Frontend guidelines: `.atw/spec/adapter-workbuddy/frontend/`

### Package: codexhost-launcher (`spec/codexhost-launcher/`)

- Backend guidelines: `.atw/spec/codexhost-launcher/backend/`

### Package: codexhost-platform (`spec/codexhost-platform/`)

- Backend guidelines: `.atw/spec/codexhost-platform/backend/`

### Package: codexhost-shim (`spec/codexhost-shim/`)

- Backend guidelines: `.atw/spec/codexhost-shim/backend/`

### Package: codexhost-updater (`spec/codexhost-updater/`)

- Backend guidelines: `.atw/spec/codexhost-updater/backend/`

### Package: codexhost-gate-a-native (`spec/codexhost-gate-a-native/`)

- Backend guidelines: `.atw/spec/codexhost-gate-a-native/backend/`


### Thinking guides (already populated)

`.atw/spec/guides/` contains general thinking guides pre-filled with
best practices. Customize only if something clearly doesn't fit this project.

---

## How to fill the spec

### Step 1: Import from existing convention files first (preferred)

Search the repo for existing convention docs. If any exist, read them and
extract the relevant rules into the matching `.atw/spec/` files —
usually much faster than documenting from scratch.

| File / Directory | Tool |
|------|------|
| `CLAUDE.md` / `CLAUDE.local.md` | Claude Code |
| `AGENTS.md` | Codex / Claude Code / agent-compatible tools |
| `.cursorrules` | Cursor |
| `.cursor/rules/*.mdc` | Cursor (rules directory) |
| `.windsurfrules` | Windsurf |
| `.clinerules` | Cline |
| `.roomodes` | Roo Code |
| `.github/copilot-instructions.md` | GitHub Copilot |
| `.vscode/settings.json` → `github.copilot.chat.codeGeneration.instructions` | VS Code Copilot |
| `CONVENTIONS.md` / `.aider.conf.yml` | aider |
| `CONTRIBUTING.md` | General project conventions |
| `.editorconfig` | Editor formatting rules |

### Step 2: Analyze the codebase for anything not covered by existing docs

Scan real code to discover patterns. Before writing each spec file:
- Find 2-3 real examples of each pattern in the codebase.
- Reference real file paths (not hypothetical ones).
- Document anti-patterns the team clearly avoids.

### Step 3: Document reality, not ideals

**Critical**: write what the code *actually does*, not what it should do.
Sub-agents match the spec, so aspirational patterns that don't exist in the
codebase will cause sub-agents to write code that looks out of place.

If the team has known tech debt, document the current state — improvement
is a separate conversation, not a bootstrap concern.

---

## Quick explainer of the runtime (share when they ask "why do we need spec at all")

- Every ticket runs through `/atw-implement` in the main session (writes
  code), which dispatches two `atw-review` sub-agents (verify quality).
  No implementation sub-agent is spawned.
- Each task has `implement.jsonl` / `check.jsonl` manifests listing which
  spec files to load.
- The platform hook auto-injects those spec files + the task's `prd.md`
  into every sub-agent prompt, so the sub-agent codes/reviews per team
  conventions without anyone pasting them manually.
- Source of truth: `.atw/spec/`. That's why filling it well now pays
  off forever.

---

## Completion

When the developer confirms the checklist items above are done with real
examples (not placeholders), guide them to run:

```bash
python3 ./.atw/scripts/task.py finish
python3 ./.atw/scripts/task.py archive 00-bootstrap-guidelines
```

After archive, every new developer who joins this project will get a
`00-join-<slug>` onboarding task instead of this bootstrap task.

---

## Suggested opening line

"Welcome to ATW! Your init just set me up to help you fill the project
spec — a one-time setup so every future AI session follows the team's
conventions instead of writing generic code. Before we start, do you have
any existing convention docs (CLAUDE.md, .cursorrules, CONTRIBUTING.md,
etc.) I can pull from, or should I scan the codebase from scratch?"
