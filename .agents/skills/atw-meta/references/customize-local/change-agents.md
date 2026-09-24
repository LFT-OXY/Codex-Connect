# Change Local Agents

When the user wants to change `atw-review` or `atw-implement-agent` behavior, edit platform agent files in the user project.

## Read These Files First

1. Target platform agent directory
2. `.atw/workflow.md` Phase 2 / agent routing
3. Current task `prd.md`
4. Current task `implement.jsonl` / `check.jsonl`
5. Relevant hook or agent prelude

## Common Paths

| Platform | Path |
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

Use the actual paths in the user project as authoritative.

## Common Needs

| Need | Which agent to edit |
| --- | --- |
| Certain local specs must be read before implementation | `atw-implement-agent` + `implement.jsonl` configuration rules |
| Specific commands must run during review | `atw-review` |
| Agent must not modify certain directories | The corresponding agent's write boundary instructions |
| Agent output format must be fixed | The corresponding agent's final/reporting instructions |

## Modification Principles

1. **Preserve role boundaries**: implement writes implementation; review checks changes against project standards and the task spec, then fixes what it finds.
2. **Do not hard-code project specs into agents**: long-term specs belong in `.atw/spec/`; agents are responsible for reading them.
3. **Make read order explicit**: active task -> PRD -> info -> JSONL -> spec/research.
4. **Make write boundaries explicit**: which directories may be written and which may not.
5. **Synchronize across platforms**: when the user configured multiple platforms, decide whether to change only the current platform or all platform agents.

## Agent Pull Platforms

If an agent file contains a prelude for "read task/context after startup," do not remove those steps when editing. Otherwise the agent will work only from chat context and bypass ATW's core mechanism.

## Hook Push Platforms

If context is injected by a hook, the agent file should still retain responsibility boundaries. Do not remove PRD/spec requirements from the agent just because a hook injects context.
