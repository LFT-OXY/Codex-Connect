# Add Project-Local Conventions

Often the user does not need to change ATW mechanics; they need local AI to understand their team's conventions. In that case, prefer `.atw/spec/` or a project-local skill instead of editing `atw-meta`.

## Where To Put Things

| Content type | Location |
| --- | --- |
| Rules code must follow | `.atw/spec/<layer>/` |
| Cross-layer thinking methods | `.atw/spec/guides/` |
| AI capability for a project-specific flow | Platform-local skill |
| One-off task material | `.atw/tasks/<task>/` |
| Session summary | `.atw/workspace/<developer>/journal-N.md` |

## Create A Project-Local Skill

If the user wants AI to know "how this project customizes ATW," create a local skill:

```text
.claude/skills/atw-local/
└── SKILL.md
```

Example:

```md
---
name: atw-local
description: "Project-local ATW customizations for this repository. Use when changing this project's ATW workflow, hooks, local agents, or team-specific conventions."
---

# ATW Local

## Local Scope

This skill documents this repository's ATW customizations only.

## Custom Workflow Rules

- ...

## Local Hook Changes

- ...

## Local Agent Changes

- ...
```

For multi-platform projects, place equivalent versions in other platform skill directories, or use `.agents/skills/` for platforms that support the shared layer.

## Write To `.atw/spec/`

If the content is a coding convention, write it to spec. Examples:

```text
.atw/spec/backend/error-handling.md
.atw/spec/frontend/components.md
.atw/spec/guides/cross-platform-thinking-guide.md
```

After writing it, update the corresponding `index.md` so AI can find the new rule from the entry point.

## Make The Current Task Use New Conventions

After writing a spec, add it to the current task context:

```bash
python3 ./.atw/scripts/task.py add-context <task> implement ".atw/spec/backend/error-handling.md" "Error handling conventions"
python3 ./.atw/scripts/task.py add-context <task> check ".atw/spec/backend/error-handling.md" "Review error handling"
```

## Do Not Store Project-Private Rules In `atw-meta`

`atw-meta` is a public skill for understanding ATW architecture and local customization entry points. Put project-private content in:

- `.atw/spec/`
- a project-local skill
- the current task
- workspace journal

This prevents future updates to ATW's built-in `atw-meta` from overwriting the team's own conventions.
