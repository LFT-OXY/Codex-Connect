# Development Workflow

---

## Core Principles

1. **Plan before code** — figure out what to do before you start
2. **Specs injected, not remembered** — guidelines are injected via hook/skill, not recalled from memory
3. **Persist everything** — research, decisions, and lessons all go to files; conversations get compacted, files don't
4. **One ticket at a time** — serial execution; claim, finish, close, then take the next
5. **Capture learnings** — after each ticket, review and write new knowledge back to spec

---

## ATW System

### Developer Identity

On first use, initialize your identity:

```bash
python3 ./.atw/scripts/init_developer.py <your-name>
```

Creates `.atw/.developer` (gitignored) + `.atw/workspace/<your-name>/`.

### Spec System

`.atw/spec/` holds coding guidelines organized by package and layer.

- `.atw/spec/<package>/<layer>/index.md` — entry point with **Pre-Development Checklist** + **Quality Check**. Actual guidelines live in the `.md` files it points to.
- `.atw/spec/guides/index.md` — cross-package thinking guides.

```bash
python3 ./.atw/scripts/get_context.py --mode packages   # list packages / layers
```

**When to update spec**: new pattern/convention found · bug-fix prevention to codify · new technical decision.

### Task System

Every task has its own directory under `.atw/tasks/{MM-DD-name}/`:

```
.atw/tasks/MM-DD-<slug>/
├── task.json          task record (status, branch, metadata, hooks)
├── prd.md             the spec — requirements, constraints, acceptance criteria
├── map.md             territory map; complex path only
├── map-issues/NN-*.md decision tickets (Type / Status / Blocked by)
├── issues/NN-*.md     implementation tickets (Blocked by / Impl)
├── research/<topic>.md research notes
└── check.jsonl        spec manifest + current-ticket path for review sub-agents
```

`task.json.status` is one of six literal stages, in order:

```
discover → specify → slice (optional) → implement → accept → completed
```

```bash
# Task lifecycle
python3 ./.atw/scripts/task.py create "<title>" --description "<desc>" [--slug <name>] [--parent <dir>]
python3 ./.atw/scripts/task.py set-status <name> <stage>   # move between the six stages
python3 ./.atw/scripts/task.py start <name>          # set active task; any planning stage → implement
python3 ./.atw/scripts/task.py current --source      # show active task and source
python3 ./.atw/scripts/task.py finish                # clear active task (triggers after_finish hooks)
python3 ./.atw/scripts/task.py archive <name>        # → completed, move to archive/{year-month}/
python3 ./.atw/scripts/task.py list [--mine] [--status <s>]
python3 ./.atw/scripts/task.py list-archive

# Review context (injected into review sub-agents via check.jsonl).
# `check.jsonl` is seeded (empty) on `task create` for sub-agent-capable platforms;
# you curate real spec + research entries during planning. `validate` fails and
# `start` refuses while a seeded manifest is still empty — review sub-agents would
# run with zero spec context. Pass `start --allow-empty-context` when that is
# intentional.
python3 ./.atw/scripts/task.py add-context <name> check <file> <reason>
python3 ./.atw/scripts/task.py list-context <name> [check]
python3 ./.atw/scripts/task.py validate <name>

# Task metadata
python3 ./.atw/scripts/task.py set-branch <name> <branch>
python3 ./.atw/scripts/task.py set-base-branch <name> <branch>    # PR target
python3 ./.atw/scripts/task.py set-scope <name> <scope>

# Hierarchy (parent/child)
python3 ./.atw/scripts/task.py add-subtask <parent> <child>
python3 ./.atw/scripts/task.py remove-subtask <parent> <child>

# PR creation
python3 ./.atw/scripts/task.py create-pr [name] [--dry-run]
```

> Run `python3 ./.atw/scripts/task.py --help` to see the authoritative, up-to-date list.

**Current-task mechanism**: `task.py create` creates the task directory with `status=discover` and (when session identity is available) auto-sets the per-session active-task pointer so the discover breadcrumb fires immediately. `task.py set-status` moves the task between the six stages without touching the pointer. `task.py start` writes the same pointer (idempotent if already set) and flips `task.json.status` from whichever planning stage the task is in (`discover` / `specify` / `slice`) to `implement`; a task already at `implement` or later keeps its stage, so re-running `start` after a checkout is a pure resume. State is stored under `.atw/.runtime/sessions/`. If no context key is available from hook input, `ATW_CONTEXT_ID`, or a platform-native session environment variable, there is no active task and `task.py start` fails with a session identity hint. `task.py finish` deletes the current session file (status unchanged). `task.py archive <task>` writes `status=completed`, moves the directory to `archive/`, and deletes any runtime session files that still point at the archived task.

### Ticket System

Implementation tickets live in `{TASK_DIR}/issues/NN-slug.md` and carry two fields the tooling reads literally:

```
**Impl:** ready | doing | done
**Blocked by:** none
```

```bash
python3 ./.atw/scripts/tickets.py list       [--task-dir <dir>]   # every ticket + state
python3 ./.atw/scripts/tickets.py frontier   [--task-dir <dir>]   # ready tickets with dependencies cleared
python3 ./.atw/scripts/tickets.py claim NN   [--task-dir <dir>]   # ready → doing
python3 ./.atw/scripts/tickets.py done NN    [--task-dir <dir>]   # doing → done
python3 ./.atw/scripts/tickets.py summary    [--task-dir <dir>]
python3 ./.atw/scripts/tickets.py selfcheck
```

**The current ticket is the single `issues/` ticket marked `**Impl:** doing`.** The per-turn hook reads that directly from the ticket files. Two tickets marked `doing` at once is a broken state, not a choice — clear it before continuing.

Decision tickets from the map live in `{TASK_DIR}/map-issues/` and use a different vocabulary (`Type` / `Status` / `Blocked by`). **Never mix the two directories**: `tickets.py` only reads `issues/`, and a decision ticket filed there corrupts the frontier in both directions.

### Workspace System

Records every AI session for cross-session tracking under `.atw/workspace/<developer>/`.

- `journal-N.md` — session log. **Max 2000 lines per file**; a new `journal-(N+1).md` is auto-created when exceeded.
- `index.md` — personal index (total sessions, last active).

```bash
python3 ./.atw/scripts/add_session.py --title "Title" --commit "hash" --summary "Summary"
```

### Context Script

```bash
python3 ./.atw/scripts/get_context.py                            # full session runtime
python3 ./.atw/scripts/get_context.py --mode packages            # available packages + spec layers
python3 ./.atw/scripts/get_context.py --mode phase --step <X.Y>  # detailed guide for a workflow step
```

---

<!--
  WORKFLOW-STATE BREADCRUMB CONTRACT (read this before editing the tag blocks below)

  The [workflow-state:STATUS] blocks embedded in the ## Phase Index section
  below are the SINGLE source of truth for the per-turn `<workflow-state>`
  breadcrumb that every supported AI platform's UserPromptSubmit hook
  reads. inject-workflow-state.py (Python platforms) and
  inject-workflow-state.js (OpenCode plugin) only parse them — there is no
  fallback dict baked into the scripts.

  STATUS charset: [A-Za-z0-9_-]+. The tag name is matched against
  `task.json.status` verbatim, so the six stage tags below must stay
  spelled exactly as `discover` / `specify` / `slice` / `implement` /
  `accept` / `completed`. When the hook can't find a tag, it degrades to a
  generic "Refer to workflow.md for current step." line — intentionally
  visible so users notice and fix a broken workflow.md.

  INVARIANT:
    Every workflow-walkthrough step marked `[required · once]` must have a
    matching enforcement line in its stage's [workflow-state:*] block. The
    breadcrumb is the only per-turn channel; if a mandatory step isn't
    mentioned there, the AI silently skips it.

  TAG ↔ STAGE scoping:
    [workflow-state:no_task]      → no active task; before Phase 1
    [workflow-state:task_error]   → active task record is unreadable; repair it before continuing
    [workflow-state:discover]     → Phase 1 steps 1.0-1.1 (the create default)
    [workflow-state:specify]      → Phase 1 steps 1.2-1.3
    [workflow-state:slice]        → Phase 1 step 1.4 (optional stage)
    [workflow-state:implement]    → all of Phase 2 (task.py start sets it)
    [workflow-state:accept]       → all of Phase 3, up to archive
    [workflow-state:completed]    → archive was interrupted; task still under .atw/tasks/

  The tag set is "every state the active-task resolver can hand the hook",
  not "the six stages": `no_task` and `task_error` are not task statuses at
  all, and `completed` is reachable because `task.py archive` is not atomic —
  it writes the status, re-parents children, then moves the directory, and it
  does not roll back. An archive interrupted between those steps leaves a
  `completed` task the resolver still finds.

  Editing checklist:
    - When you change a [workflow-state:STATUS] block, also check the
      matching stage's `[required · once]` walkthrough steps for sync
    - Run `atw update` after editing to push the new bodies to
      downstream user projects (block-level managed replacement)
    - `packages/cli/test/scripts/workflow-structure.test.ts` guards this
      file's structure and runs with `pnpm test` — nothing to remember
-->

## Phase Index

```
Phase 1: Plan    → discover, specify, and (when needed) slice into tickets
Phase 2: Execute → one ticket at a time, each through the full implement chain
Phase 3: Finish  → read-only acceptance check, then archive
```

### Request Triage

Three complexity paths. The AI proposes, the user decides whether a task gets created at all.

| Path | Route |
|---|---|
| Simple | No task. Just do it, skip ATW for this session. |
| Medium | Create task → discover → specify → implement |
| Complex | Create task → map (decision tickets) → specify → slice into tickets → implement each |

The threshold is deliberately not a file count. Changing two files can be a typo fix or an auth rewrite. **When unsure, go one path up** — the cost of going up is one more `prd.md`; the cost of going down is discovering mid-build that there is no record, no spec, and no review baseline.

**Before picking a path, separate what the request *asserts* from what it *estimates*.**

Assertions are checkable: an error message, a reproduction, a decision already
made, a line of code. Estimates are the requester's guesses about size — "should
be quick", "just a small flag", "this one's complex, run map". **A path the
requester names is an estimate too, not an instruction.**

Grade on the assertions. Then check the estimates the grade depends on: if an
estimate is checkable from the repo or from the request itself, check it now
rather than noting it as an assumption. When a check moves the path, say so and
say which way — then the call is the user's.

Map is worth running when the work is both **large** and **the route is unclear**. Large but well-understood goes straight to slicing. When unsure, run it: it scans breadth-first and stops itself if it finds no fog, at a cost of two turns.

### The Four Stops

Outside these four, the AI advances stages on its own. It does not stop to ask "shall we move on?".

| # | Where | Whose call |
|---|---|---|
| ① | Before creating a task | Does this work deserve a record — the user's |
| ② | After the spec is written | Is the spec right — the user's |
| ③ | Before each ticket starts | The user runs `/atw-implement`; the AI cannot invoke it |
| ④ | Before archiving | "This is done" — the user's acceptance |

### Planning Artifacts

- `prd.md` — requirements, constraints, and acceptance criteria. This is the spec; everything downstream is checked against it.
- `map.md` + `map-issues/NN-*.md` — territory map and its decision tickets. Complex path only.
- `issues/NN-*.md` — implementation tickets. Created by slicing; skipped for single-session work.
- `research/<topic>.md` — research notes, one file per topic.
- `check.jsonl` — spec/research manifest for the review sub-agents, plus the current ticket path.

### Tickets vs Parent / Child Task Trees

Both splitting mechanisms exist and they are not interchangeable. **The test is whether the pieces can be accepted and shipped independently.**

- **Yes, independently shippable** → child tasks. Each child gets its own `prd.md`, its own review, and archives on its own. Create with `task.py create "<title>" --description "<desc>" --slug <name> --parent <parent-dir>`; link existing tasks with `task.py add-subtask`, unlink with `task.py remove-subtask`.
- **No, they only count as done together** → tickets. All tickets share one `prd.md` and archive with the task. Ordering between them is a real dependency graph: write it in `**Blocked by:**` and let `tickets.py frontier` compute what is workable.

A parent task owns the source requirements, the child map, cross-child acceptance criteria, and final integration review. It is not itself an implementation target unless it also has direct work. Parent/child is **not** a dependency system — if child B must wait for child A, write that ordering into child B's `prd.md`.

<!-- Per-turn breadcrumb: shown when there is no active task (before Phase 1) -->

[workflow-state:no_task]
No active task. First classify the request against the three complexity paths, then ask for task-creation consent before creating any ATW task.
Simple: ask only whether this turn should create an ATW task. If the user says no, skip ATW for this session.
Medium or complex: ask the user if you may create an ATW task and enter discover. If the user says no, explain, clarify scope, or suggest a smaller split.
[/workflow-state:no_task]

<!-- Per-turn breadcrumb: shown when the active task record cannot be read. -->

[workflow-state:task_error]
The active task record could not be read. Do not create or activate another task.
Inspect the task directory named above and repair its task.json. It must be a valid JSON object with a non-empty status.
Preserve existing task fields and artifacts. If the correct status cannot be determined safely, ask the user before reconstructing the record.
[/workflow-state:task_error]

### Phase 1: Plan

- 1.0 Create task `[required · once]` (only after stop ①)
- 1.1 Discover `[required · repeatable]` (stage `discover`)
- 1.2 Specify `[required · once]` (stage `specify`; `prd.md`, then stop ②)
- 1.3 Configure context `[required · once]` — sub-agent-dispatch platforms curate `check.jsonl`; inline platforms skip
- 1.4 Slice `[optional · once]` (stage `slice`; only when the work needs tickets)
- 1.5 Activate task `[required · once]` (`task.py start`; status → `implement`)

<!-- Per-turn breadcrumb: stage 'discover' — the status task.py create writes -->

[workflow-state:discover]
Stay in discover. Do not write code and do not create tickets yet.
Tell the user to run `/atw-askme` (or `/atw-askme-with-docs` when the answer lives in project docs) to work through open requirements. Suggest `/atw-map` when the work is large and the route is unclear, `/atw-prototype` when a design question needs a throwaway build, and `/atw-research` for external unknowns.
Gate out of discover: not one question you raised this session may still be unanswered by the user. If any is open, ask it now instead of advancing.
When clear, run `task.py set-status <task> specify` yourself — this is not a stop.
[/workflow-state:discover]

<!-- Per-turn breadcrumb: stage 'specify' -->

[workflow-state:specify]
Tell the user to run `/atw-spec` to turn the discover findings into `{TASK_DIR}/prd.md`. Keep requirements, constraints, and acceptance criteria there; no execution checklists.
On sub-agent-dispatch platforms, curate `check.jsonl` with the spec and research files the review axes need (step 1.3) before leaving this stage.
Stop ②: present the finished `prd.md` and wait for the user to confirm it before advancing. Do not begin implementation on your own judgment that the spec looks right.
After the user confirms, decide whether the work needs tickets: `task.py set-status <task> slice` if yes, otherwise go straight to step 1.5.
[/workflow-state:specify]

<!-- Per-turn breadcrumb: stage 'slice' (optional; skipped for single-session work) -->

[workflow-state:slice]
Tell the user to run `/atw-tickets` to slice the confirmed `prd.md` into `{TASK_DIR}/issues/NN-slug.md`.
Every ticket needs `**Impl:** ready` and a `**Blocked by:**` line — those two fields are what `tickets.py` and the per-turn hook both read. Leave every ticket `ready`; claiming happens in Phase 2.
Decision tickets from `/atw-map` belong in `map-issues/`, never in `issues/`.
When the tickets are written, run `task.py start <task>` (step 1.5) to enter implement.
[/workflow-state:slice]

### Phase 2: Execute

- 2.1 Claim the next ticket `[required · repeatable]`
- 2.2 Run the implement chain `[required · repeatable]` (stop ③)
- 2.3 Relay the review reports `[required · repeatable]`
- 2.4 Close the ticket `[required · repeatable]`
- 2.5 Roll back `[on demand]`

<!-- Per-turn breadcrumb: stage 'implement' — set by task.py start, held for all of Phase 2 -->

[workflow-state:implement]
One ticket at a time. Run `tickets.py frontier`, pick one, `tickets.py claim NN` — never hold two tickets at `doing`.
Stop ③: tell the user to run `/atw-implement` for the claimed ticket. You may not invoke it yourself, and you may not do the implementation inline instead. One user invocation per ticket.
That one run is a closed chain and must not be broken up from the outside: implement (test-first where it fits) → run tests, full suite on the last pass → review → handle findings → write spec updates back → commit. Never instruct it to skip the review or the commit.
Findings triage: spec-axis findings and anything the standards axis calls a hard violation get fixed first, then a full re-review, then the commit. Judgement calls ship and get reported.
Relay both review reports to the user verbatim, even when the verdict is "nothing found". No report reaching you is not a passing review.
Any sub-agent dispatched from here starts its prompt with `Active task: <task path from task.py current>` — the role files read that line to find the task, and it is the context hooks' fallback when session resolution misses.
Main-session default: run the process; the implementation itself is written inside `/atw-implement`, never by a dispatched `atw-implement-agent` — that role file is reserved and is not a step in this flow. The only sub-agent this phase raises is `atw-review` (twice, from inside `/atw-implement`). Sub-agent self-exemption: this breadcrumb reaches sub-agent turns on some hosts, so if you are already running as `atw-review`, do NOT spawn another `atw-review` — do the review you were dispatched for. Dispatch is main session only.
Then `tickets.py done NN` and back to the frontier. When the frontier is empty, run `task.py set-status <task> accept`.
[/workflow-state:implement]

### Phase 3: Finish

- 3.1 Acceptance check `[required · once]` (read-only; then stop ④)
- 3.2 Archive `[required · once]`

<!-- Per-turn breadcrumb: stage 'accept' — read-only until the user accepts -->

[workflow-state:accept]
Read-only from here. Do not open new work, do not fix things you notice — file them as tickets or a follow-up task instead.
Walk the acceptance criteria in `prd.md` one by one and report which are met, with evidence. Confirm `tickets.py summary` shows every ticket `done` and `git status --porcelain` is clean.
Stop ④: present that and wait for the user to accept. Acceptance is the user's judgement, not yours.
Once accepted, run `task.py archive <task>` — status goes to `completed` and the task moves to `archive/`.
[/workflow-state:accept]

<!-- Per-turn breadcrumb: stage 'completed' — only reachable when archive was interrupted -->

[workflow-state:completed]
The archive was interrupted. `task.py archive` writes `completed` to `task.json` first, re-parents child tasks, then moves the directory — and it does not roll back, so a task still sitting under `.atw/tasks/` with this status means the move never happened.
Re-run `task.py archive <task>` to finish it. Every step before the move is idempotent, so the re-run redoes them and completes the move; the original `completedAt` is kept.
Do not open new work, do not create another task, and do not move the directory by hand. If the re-run fails, report the error to the user instead of working around it.
[/workflow-state:completed]

### Rules

1. Identify which stage the task is in, then continue from the next step there
2. Run steps in order inside each phase; `[required]` steps can't be skipped
3. Stages can roll back (implement exposes a spec defect → `set-status specify`, fix `prd.md`, then return)
4. Steps tagged `[once]` are skipped if the output already exists; don't re-run
5. A missing `issues/` directory is a valid single-session task, not incomplete planning. A missing `prd.md` never is.

### Active Task Routing

When a user request matches one of these intents inside an active task, route first, then load the detailed step if needed.

- Requirements still fuzzy → `/atw-askme`, or `/atw-askme-with-docs` when the answer is in project docs
- Large scope, unclear route → `/atw-map`
- External or third-party unknowns → `/atw-research`; design question needing a throwaway build → `/atw-prototype`
- Writing or revising the spec → `/atw-spec`
- Slicing a confirmed spec into tickets → `/atw-tickets`
- Starting a claimed ticket → `/atw-implement` (the user runs it; stop ③)
- Same bug fixed more than once → `/atw-diagnosing-bugs`
- Knowledge worth keeping outside a ticket → `/atw-update-spec`

Six of these are user-triggered and the AI cannot invoke them: `/atw-askme`,
`/atw-askme-with-docs`, `/atw-map`, `/atw-spec`, `/atw-tickets`, `/atw-implement`.
Name the one that fits and let the user run it — calling the Skill tool on one
returns an error and nothing else.

### Guardrails

- Consent to create a task is not consent to implement. Implementation starts at `task.py start`, after the user confirms `prd.md`.
- Stops ①–④ are the user's calls. Never advance through one by inferring the answer.
- Planning must be persisted to task artifacts; the review chain must run before reporting a ticket complete.
- Never mark two tickets `**Impl:** doing` at the same time.

### Loading Step Detail

At each step, run this to fetch detailed guidance:

```bash
python3 ./.atw/scripts/get_context.py --mode phase --step <step>
# e.g. python3 ./.atw/scripts/get_context.py --mode phase --step 1.1
```

---

## Phase 1: Plan

Goal: understand the request, get a confirmed spec, and — when the work needs it — a set of tickets.

#### 1.0 Create task `[required · once]`

Create the task directory only after stop ① — the user has agreed this work deserves a record. The command sets status to `discover`, writes `task.json`, creates a default `prd.md`, and auto-targets the new task when session identity is available:

```bash
python3 ./.atw/scripts/task.py create "<task title>" --description "<one-line description>" --slug <name>
```

`--slug` is the human-readable name only. Do **not** include the `MM-DD-` date prefix; `task.py create` adds that prefix automatically.

For task trees, create the parent task first and then create each child with `--parent <parent-dir>`. Do not start the parent just because children exist; start the child that owns the next independently shippable deliverable.

After this command succeeds, the per-turn breadcrumb auto-switches to `[workflow-state:discover]`.

Run only `create` here — do not also run `start`. `start` flips status straight to `implement`, which skips the whole planning stage. Save `start` for step 1.5.

Skip when `python3 ./.atw/scripts/task.py current --source` already points to a task.

#### 1.1 Discover `[required · repeatable]`

Goal: remove the unknowns before anything gets written down as a spec.

Tell the user which of these to run — you drive the conversation between them, but you do not run them for the user:

- `/atw-askme` — work through open requirement questions one at a time
- `/atw-askme-with-docs` — same, when the answers are already in project documentation
- `/atw-interview` — deeper elicitation when the request is a vague wish rather than a change
- `/atw-map` — build `map.md` plus decision tickets in `map-issues/`, for work that is both large and unclear
- `/atw-prototype` — throwaway build to settle a design question
- `/atw-research` — external unknowns: library docs, API references, industry practice

**Research artifact conventions**:

- One file per topic (e.g. `research/auth-library-comparison.md`)
- Record third-party usage examples, API references, and version constraints in the file, not in chat
- Note the spec file paths you discovered, for step 1.3

**Gate out of discover**: not one question you raised this session may still be unanswered by the user. Unanswered questions become assumptions, and assumptions become spec defects found in Phase 2. When the gate is clear:

```bash
python3 ./.atw/scripts/task.py set-status <task-dir> specify
```

This is not a stop — advance on your own judgement.

#### 1.2 Specify `[required · once]`

Tell the user to run `/atw-spec`. It turns the discover findings into `{TASK_DIR}/prd.md`.

`prd.md` holds requirements, constraints, and acceptance criteria. It does not hold an execution checklist — that is what tickets are for.

**Stop ②**: present the finished `prd.md` and wait for the user to confirm it. This is the last cheap place to be wrong. Do not advance on your own judgement that the spec looks right.

Return to this step whenever requirements change, including from Phase 2 — `set-status <task-dir> specify`, revise, then go back.

#### 1.3 Configure context `[required · once]`

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

Curate `check.jsonl` so the review sub-agents dispatched during Phase 2 get the right spec context. The file was seeded on `task create` with a single self-describing `_example` line; your job here is to fill in real entries.

**Location**: `{TASK_DIR}/check.jsonl` (already exists).

**Format**: one JSON object per line — `{"file": "<path>", "reason": "<why>"}`. Paths are repo-root relative.

**What to put in**:

- **Spec files** — `.atw/spec/<package>/<layer>/index.md` and any specific guideline files (`error-handling.md`, `conventions.md`, etc.) relevant to this task
- **Research files** — `{TASK_DIR}/research/*.md` the review axes will need to consult

**What NOT to put in**:

- Code files (`src/**`, `packages/**/*.ts`, etc.) — the review axes read those from the diff
- Files you are about to modify — same reason

The current ticket path is added to the injected context automatically at dispatch time; do not hand-maintain it here.

**How to discover relevant specs**:

```bash
python3 ./.atw/scripts/get_context.py --mode packages
```

Lists every package + its spec layers with paths. Pick the entries that match this task's domain.

**How to append entries**:

Either edit the jsonl file directly in your editor, or use:

```bash
python3 ./.atw/scripts/task.py add-context "$TASK_DIR" check "<path>" "<reason>"
```

Delete the seed `_example` line once real entries exist (optional — it's skipped automatically by consumers).

Ready gate: `check.jsonl` must contain at least one real `{"file": "...", "reason": "..."}` entry before `task.py start`. The seed `_example` row alone is not ready.

Skip this step only when the file already has real curated entries.

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

[codex-inline, Kilo, Antigravity, Devin, DeepSeek Harness]

Skip this step. There is no sub-agent dispatch on this platform, so there is nothing to inject; the review step in Phase 2 loads spec context directly.

[/codex-inline, Kilo, Antigravity, Devin, DeepSeek Harness]

#### 1.4 Slice `[optional · once]`

Decide this yourself, after the spec is confirmed — it is not a stop.

Slice when the work is more than one sitting, or when parts of it must land in a specific order. Skip it for a single-session change: an empty `issues/` directory is worse than none, because `tickets.py frontier` then reports nothing workable on a task that is perfectly workable.

```bash
python3 ./.atw/scripts/task.py set-status <task-dir> slice
```

Then tell the user to run `/atw-tickets`, which writes `{TASK_DIR}/issues/NN-slug.md`.

Each ticket carries, literally:

```
**Impl:** ready
**Blocked by:** none
```

`**Impl:**` is read by both `tickets.py` and the per-turn context hook; `**Blocked by:**` is what `tickets.py frontier` walks to compute the workable set. A ticket missing `**Impl:**` makes `tickets.py` fail outright.

Leave every ticket `ready` — claiming is a Phase 2 action.

Decision tickets produced by `/atw-map` stay in `map-issues/`. They use `Type` / `Status` / `Blocked by`, and nothing ever mirrors them out of the task directory. Implementation tickets *can* be mirrored — but only where the repo asked for it: `github_sync.py` ships wired to nothing, and `docs/agents/issue-tracker.md` is where a repo records whether it runs the mirror at all. Filing a decision ticket in `issues/` breaks the frontier in both directions.

#### 1.5 Activate task `[required · once]`

After the user has confirmed `prd.md` (stop ②), and after slicing if the work needed it:

```bash
python3 ./.atw/scripts/task.py start <task-dir>
```

This sets the active-task pointer and flips status from the current planning stage (`discover` / `specify` / `slice`) to `implement`. On sub-agent-dispatch platforms, `check.jsonl` must have real curated entries before start; runtime consumers tolerate a missing or seed-only manifest for compatibility, but that tolerance is not a planning-ready state.

If `task.py start` errors with a session-identity message (no context key from hook input, `ATW_CONTEXT_ID`, or platform-native session env), follow the hint in the error to set up session identity, then retry.

Ready to leave Phase 1:

| Condition | Required |
|------|:---:|
| `prd.md` exists and the user confirmed it (stop ②) | ✅ |
| `research/` has artifacts | recommended |
| `issues/` has tickets | only when the work was sliced |
| `task.py start` has been run (status = `implement`) | ✅ |

[Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

| `check.jsonl` contains at least one real curated entry (seed row does not count) | ✅ |

[/Claude Code, Cursor, OpenCode, codex-sub-agent, Kiro, Gemini, Qoder, CodeBuddy, Copilot, Droid, Pi, Oh My Pi, ZCode, Snow, Reasonix, Trae, Grok, Kimi Code]

---

## Phase 2: Execute

Goal: turn the confirmed spec into committed code, one ticket at a time, each one reviewed before it is closed.

The main session runs the process. It does not write the implementation itself and it does not dispatch an implementation sub-agent — the work happens inside `/atw-implement`, which the user starts.

**Sub-agent dispatch protocol** — applies to every platform and every sub-agent
dispatched anywhere in this workflow (the review sub-agents raised inside the
implement chain, native Codex `SubagentStart` injection with
child-side pull fallback, class-2 Gemini/Qoder/Copilot/Reasonix/Trae/Grok/Kimi
Code, and hook-backed ZCode/Snow): **every dispatch prompt starts with
`Active task: <task path from task.py current>`** before any role-specific
instruction.

This is an interface, not a style rule. Every `atw-review` role file tells the sub-agent to read that line out of its inbox to
locate task artifacts, and the context hooks parse the same prefix as their
fallback when session-pointer resolution misses. Drop it and the sub-agent still
starts — with no task context and no error.

**Dispatch prompt guard** — after the `Active task:` line, the prompt states the
role the spawned agent already holds. A review dispatch says it is
already the `atw-review` sub-agent and must
not spawn another `atw-review`.
Without this the guidance a sub-agent inherits reads as an instruction to
dispatch, and it dispatches itself.

Implementation is never dispatched. `atw-implement-agent` ships as a reserved
role file so the injection path stays wired (D23), but no step in this
workflow spawns it — the code is written inside `/atw-implement`.

On Grok Build, use `spawn_subagent` with `subagent_type` set to the ATW agent
name (e.g. `atw-review`). On Kimi Code, dispatch the built-in `coder` /
`explore` sub-agent for the matching ATW role — Kimi installs the role prompts
as its own private skills, so the dispatch carries the role and the platform
supplies the instructions.

#### 2.1 Claim the next ticket `[required · repeatable]`

```bash
python3 ./.atw/scripts/tickets.py frontier
```

That lists the `ready` tickets whose `**Blocked by:**` dependencies are all `done`. Pick one and claim it:

```bash
python3 ./.atw/scripts/tickets.py claim NN
```

`claim` flips the ticket to `**Impl:** doing`. That single `doing` ticket is what every context hook treats as the current ticket, so **exactly one may be claimed at a time**. If two are ever `doing`, stop and resolve it before continuing — the hooks will refuse to inject ticket content rather than guess.

For a task that was never sliced, skip to 2.2: the whole `prd.md` is the unit of work.

#### 2.2 Run the implement chain `[required · repeatable]`

**Stop ③**: tell the user to run `/atw-implement`.

You cannot invoke it and you must not substitute for it — not by implementing inline, and not by reading its instructions and following them yourself. One user invocation per ticket.

That single run is a closed chain:

1. Implement, test-first where the change suits it
2. Run tests periodically; a full-suite run on the last pass
3. Review the change on both axes — spec compliance and coding standards
4. Handle the findings (see triage below)
5. Write new knowledge back into `.atw/spec/`
6. Commit to the current branch

**Do not break this chain up from the outside.** Instructions like "implement but don't review" or "skip the commit" put two directly conflicting sets of orders in front of the same agent; what comes back is unpredictable rather than merely reduced.

**Findings triage**:

| Finding | Handling |
|---|---|
| Spec-axis finding (the change does not match `prd.md` or the ticket) | Fix first, then re-run the full review, then commit |
| Standards-axis finding marked a hard violation | Same — fix, full re-review, then commit |
| Standards-axis judgement call | Commit as-is and report it to the user |

The hard gate on this work is the test suite, not the review. Reviews report; tests block.

Spec updates belong in the same chain, before the commit — knowledge that lands in a follow-up commit usually does not land at all.

#### 2.3 Relay the review reports `[required · repeatable]`

Pass both review reports back to the user **as written**. Do not merge them, do not re-rank them, do not pick a winner, and do not summarize a clean report away — "checked, nothing found" is still a report the user is entitled to see.

Not receiving a report is not the same as a review that passed. If no report came back, the review did not run; say so and re-run it rather than proceeding.

#### 2.4 Close the ticket `[required · repeatable]`

```bash
python3 ./.atw/scripts/tickets.py done NN
```

Then return to 2.1 for the next frontier ticket. When `tickets.py frontier` comes back empty and `tickets.py summary` shows every ticket `done`, move the task on:

```bash
python3 ./.atw/scripts/task.py set-status <task-dir> accept
```

#### 2.5 Roll back `[on demand]`

- Review exposes a spec defect → `task.py set-status <task-dir> specify`, fix `prd.md` (step 1.2), re-confirm with the user, then `set-status <task-dir> implement` and redo the ticket
- The slice itself turned out wrong → back to step 1.4 and re-cut the tickets; do not paper over it by widening the ticket you are holding
- Implementation went wrong → revert the code, keep the ticket claimed, rerun 2.2
- Missing information → research as in step 1.1, writing findings into `research/`

#### 2.6 Same bug twice `[on demand]`

If the same issue has now been fixed more than once, stop patching and tell the user to run `/atw-diagnosing-bugs` — it classifies the root cause, explains why the earlier fixes did not hold, and proposes prevention worth writing into `.atw/spec/`.

---

## Phase 3: Finish

Goal: confirm with the user that the work is actually done, then archive it.

#### 3.1 Acceptance check `[required · once]`

**Read-only.** Do not start new work here and do not fix problems you notice in passing — file them as tickets or a follow-up task. A "quick fix" at this point is unreviewed, uncommitted work sitting between the user's acceptance and the archive.

Walk `prd.md`'s acceptance criteria one at a time and report, per criterion, whether it is met and what the evidence is. Also confirm:

```bash
python3 ./.atw/scripts/tickets.py summary   # every ticket done
git status --porcelain                      # clean tree; the chain commits as it goes
```

**Stop ④**: present that and wait. Whether the work is done is the user's judgement, not yours — you can report that every criterion is met, but you cannot accept on their behalf.

#### 3.2 Archive `[required · once]`

Once the user accepts:

```bash
python3 ./.atw/scripts/task.py archive <task-dir>
```

This writes `status=completed`, moves the directory to `archive/{year-month}/`, and clears any runtime session pointer still aimed at it. `after_archive` lifecycle hooks fire here.

Archiving ends the task; there is no further task-level step. Session wrap-up is a different scope: tell the user they can run the `finish-work` command to record the session journal (`add_session.py`) and archive any other tasks that finished alongside this one. This file is task-scoped, which is why nothing here drives it.

---

## Customizing ATW (for forks)

This section is for developers who want to modify the ATW workflow itself. All customization is done by editing this file; the scripts are parsers only.

### Changing what a step means

Edit the corresponding step's walkthrough body in the Phase 1 / 2 / 3 sections above. Critical invariants:

- No active task must triage first and ask for task-creation consent before creating an ATW task.
- Each of the four stops must stay reachable and must stay the user's call.
- Every execution path must keep the implement chain intact: review and spec update before the commit, never after.

Structure is guarded by `packages/cli/test/scripts/workflow-structure.test.ts`, which runs with `pnpm test` — there is no separate step to remember.

### Changing the per-turn prompt text

All tag blocks live in the `## Phase Index` section above, immediately after each stage summary:

| Scope | Corresponding tag |
|---|---|
| No active task (before Phase 1) | `[workflow-state:no_task]` |
| Active task record unreadable | `[workflow-state:task_error]` |
| Phase 1 steps 1.0–1.1 | `[workflow-state:discover]` |
| Phase 1 steps 1.2–1.3 | `[workflow-state:specify]` |
| Phase 1 step 1.4 | `[workflow-state:slice]` |
| All of Phase 2 | `[workflow-state:implement]` |
| All of Phase 3 up to archive | `[workflow-state:accept]` |
| Archive interrupted; task still under `.atw/tasks/` | `[workflow-state:completed]` |

Directly edit the body of the corresponding `[workflow-state:STATUS]` block. After editing, run `atw update` (if you're a template maintainer) or restart your AI session (if you're customizing your own project) — no script changes required.

`completed` has a block because `task.py archive` is not atomic: it writes the status, re-parents children, then moves the directory, and it does not roll back. An archive interrupted between those steps leaves a `completed` task the active-task resolver still finds, so the hook can fire on one. The block tells the AI to re-run `task.py archive <task>` — the same remedy the `continue` and `start` routing tables give.

### Adding a custom status

Add a new block:

```
[workflow-state:my-status]
your per-turn prompt text
[/workflow-state:my-status]
```

That example sits inside a code fence, but the per-turn hooks do not track fences — all four parse it as a real block. It is harmless because they look a block up by the task's exact status, and nothing ever writes `my-status`, so the entry is inert. The structure guard *does* track fences, and it rejects any fenced example named after a live or retired status, so an example can never quietly stand in for a block someone deleted. Give your example a name of its own.

Constraints:

- STATUS charset: `[A-Za-z0-9_-]+` (underscores and hyphens allowed, e.g. `in-review`, `blocked-by-team`)
- Something must write `task.json.status` to your custom value — `task.py set-status` only accepts the six built-in stages, so a custom value needs a lifecycle hook to write it
- Lifecycle hooks live in `task.json.hooks.after_*` and bind to one of `after_create / after_start / after_finish / after_archive`

### Adding a lifecycle hook

Add a `hooks` field to your `task.json`:

```json
{
  "hooks": {
    "after_finish": [
      "your-script-or-command-here"
    ]
  }
}
```

Supported events: `after_create / after_start / after_finish / after_archive`. Note that `after_finish` ≠ a status change (it only clears the active-task pointer); use `after_archive` for "task is done" notifications.

### Full contract

For the workflow state machine's runtime contract, the locations of all status writers, pseudo-statuses (`no_task` / `stale_<source_type>`), the hook reachability matrix, and other deep details, see:

- `.atw/spec/cli/backend/workflow-state-contract.md` — runtime contract + writer table + test invariants
- `.atw/scripts/inject-workflow-state.py` — actual parser (reads workflow.md only, no embedded text)
