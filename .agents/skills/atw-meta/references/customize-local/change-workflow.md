# Change Local Workflow

When the user wants to change ATW phases, next-action hints, whether to create tasks, whether to use sub-agents, or when to check/wrap up, edit `.atw/workflow.md` first.

## Read These Files First

1. `.atw/workflow.md`
2. Entry files for the current platform, such as skills/commands/prompts/workflows
3. The current task's `task.json` and `prd.md`

## Common Needs And Edit Points

| Need | Edit point |
| --- | --- |
| Change phase names or phase order | `Phase Index` and the corresponding Phase sections. |
| Change whether to create a task when there is no task | `[workflow-state:no_task]` state block. |
| Change the next step during discovery | Phase 1 and `[workflow-state:discover]`. |
| Change whether an agent is required during implementation | Phase 2 and `[workflow-state:implement]`. |
| Change wrap-up before archiving | Phase 3 and `[workflow-state:accept]`. |
| Change which skill a user intent triggers | `Skill Routing` table. |

## Modification Steps

1. Find the relevant section in `.atw/workflow.md`.
2. When changing rules, keep explicit trigger conditions and next actions.
3. If adding or renaming a skill/agent, synchronize the corresponding files in platform directories.
4. Workflow-state changes only need an edit to the `[workflow-state:STATUS]` block in `.atw/workflow.md`. The hook is parser-only — it reads whatever you put in the block. Keep the opening and closing tags' STATUS strings identical (`[workflow-state:foo]…[/workflow-state:foo]`); mismatched STATUS pairs are silently dropped.
5. Make the AI reread `.atw/workflow.md`; do not keep using rules from the old conversation.

## Example: Relax Task Creation Requirements

To change when task creation can be skipped, usually edit `[workflow-state:no_task]`:

```md
[workflow-state:no_task]
Task is not required when the answer is a one-reply explanation, no files are changed, and no research is needed.
[/workflow-state:no_task]
```

If the formal Phase 1 flow also needs to change, synchronize the Phase 1 section.

## Example: One Platform Does Not Use Sub-Agents

If the user wants only one platform to avoid sub-agents, first confirm whether that platform has a separate group in the workflow. Then change Phase 2 routing for that platform group instead of deleting all `atw-implement-agent` / `atw-review` instructions across platforms.

## The `continue` Route Table

The `continue` command resumes a task by deciding which phase step to load next: the task's `status` *is* the route, one stage to one step.

**The table is not reproduced here.** Read it where it lives, so you are never editing against a stale copy:

- `.atw/workflow.md` — the authority. Its `### Phase 1: Plan` / `### Phase 2: Execute` / `### Phase 3: Finish` sections list the step numbers, and one `[workflow-state:<stage>]` block per stage says what to do in that stage.
- The `continue` command file for your platform — the rendered routing table. Its path is platform-dependent (`.claude/commands/atw/continue.md`, `.pi/prompts/atw-continue.md`, `.agents/skills/atw-continue/SKILL.md`, …); the `hashes` keys in `.atw/.template-hashes.json` are the exact relative paths your install actually has.

When you add a custom status (e.g. `in-review`), change both: add a `[workflow-state:in-review]` block in `.atw/workflow.md` for the per-turn breadcrumb, AND add a row to the `continue` command file that decides where to resume from. Without the route entry, `continue` has no row for that status and the user will not land on the step you intended.

## Notes

`.atw/workflow.md` is the local project workflow, not an immutable template. The user can adapt it to team habits. After editing it, platform entry files may still contain old descriptions, so inspect them too.
