# Agents

ATW agent files define specialized roles. Common ATW agents in a user project are:

- `atw-implement-agent`
- `atw-review`

File locations and formats differ by platform, but responsibility boundaries should stay consistent.

## Agent Responsibilities

| Agent | Responsibility |
| --- | --- |
| `atw-implement-agent` | Reserved. The workflow does not dispatch it — implementation runs in the main session via `/atw-implement`. |
| `atw-review` | Review changes, fix discovered issues, and run necessary checks. |

Research is no longer a sub-agent role. Investigation runs as a skill in the main session and writes findings into the current task's `research/`.

Agent files should not become generic chat prompts. They should define input sources, write boundaries, whether code may be changed, and how results are reported.

## Common Paths

| Platform | Agent path |
| --- | --- |
| Claude Code | `.claude/agents/atw-*.md` |
| Cursor | `.cursor/agents/atw-*.md` |
| OpenCode | `.opencode/agents/atw-*.md` |
| Codex | `.codex/agents/atw-*.toml` |
| Kiro | `.kiro/agents/atw-*.json` |
| Gemini CLI | `.gemini/agents/atw-*.md` |
| Qoder | `.qoder/agents/atw-*.md` |
| CodeBuddy | `.codebuddy/agents/atw-*.md` |
| Factory Droid | `.factory/droids/atw-*.md` |
| Pi Agent | `.pi/agents/atw-*.md` |
| Reasonix | `.reasonix/skills/atw-*/SKILL.md` (subagent frontmatter) |
| ZCode | `.zcode/agents/atw-*.md` |
| Kimi Code | `.kimi-code/agents/atw-*.md` (custom sub-agents; the same prompts also ship as `.kimi-code/skills/atw-*/SKILL.md`) |

GitHub Copilot agent/prompt support is provided by a combination of directories such as `.github/agents/`, `.github/prompts/`, and `.github/skills/`; inspect the files actually generated in the user project.

Main-session workflow platforms such as Kilo, Antigravity, and Devin may not have ATW sub-agent files. They usually rely on workflows/skills to guide the main session.

## Two Context Loading Modes

### hook push

The platform hook injects task context before the agent starts. The agent file itself can focus more on responsibilities and boundaries.

Common on platforms that support agent hooks.

### agent pull

The agent file instructs the agent to read after startup:

- `python3 ./.atw/scripts/task.py current --source`
- `implement.jsonl` or `check.jsonl`
- spec/research files referenced by JSONL
- current task `prd.md`

This mode fits platforms whose hooks cannot reliably rewrite sub-agent prompts.

## Local Change Scenarios

| User need | Edit location |
| --- | --- |
| Implement agent must follow extra restrictions | The platform's `atw-implement-agent` agent file. |
| Review agent must run project-specific commands | `atw-review` agent file, and `.atw/spec/` if needed. |
| Agent cannot read task context | Agent prelude or `inject-subagent-context` hook. |
| Add a project-specific agent | Platform agent directory + related workflow/command/skill entry point. |

## Modification Principles

1. **Keep responsibilities single-purpose**. Do not mix implement and review responsibilities into one agent.
2. **Specify the read order**. Agents must know to start from the active task, read jsonl/spec context, then read `prd.md`.
3. **Specify write boundaries**. Implement can write code; review can fix the issues it finds.
4. **Keep semantics synchronized in multi-platform projects**. If the user configured Claude, Codex, and Cursor together, decide whether changes to one platform's agent also need to be applied to others.

## Do Not Default To Editing Upstream Templates

Local AI should default to modifying platform agent files inside the user project. Discuss upstream template source only when the user explicitly wants to contribute the change back to ATW.
