# Local Multi-Agent Channel Runtime

`atw channel` is the local multi-agent collaboration runtime shipped with the ATW CLI. It lets the main AI session spawn peer workers (Claude Code, Codex, or any agent definition under `.atw/agents/`), exchange durable messages through an event log, and coordinate review or brainstorm loops without hand-stitching shell pipelines.

This reference covers how channels are wired into the user project so an AI customizing the project knows what to edit. For runtime usage (commands, forum/thread patterns, worker spawn flags), defer to the bundled `atw-channel` capability skill.

## Local System Model

The channel runtime spans three local surfaces:

1. **Storage layer** in the user's home directory: durable event logs and worker state files.
2. **Agent definitions** inside the project at `.atw/agents/`: platform-agnostic role cards consumed by `atw channel spawn --agent <name>`.
3. **Project configuration** in `.atw/config.yaml`: worker guard thresholds and other channel knobs.

## Core Paths

| Path | Purpose |
| --- | --- |
| `~/.atw/channels/<project>/<channel>/events.jsonl` | Per-channel append-only event log. Sequence-locked, replay-safe. |
| `~/.atw/channels/<project>/<channel>/<channel>.lock` | Channel-level write lock. |
| `~/.atw/channels/<project>/<channel>/<worker>.spawnlock` | Per-worker spawn lock used by the OOM guard. |
| `~/.atw/channels/<project>/<channel>/.seq` | Sequence sidecar for ordered event assignment. |
| `~/.atw/channels/_global/<channel>/...` | Channels created with `--scope global`. The project bucket is replaced by a shared key. |
| `.atw/agents/review.md` | Default Review Agent role definition consumed by `--agent review`. |
| `.atw/agents/implement-agent.md` | Default Implement Agent role definition consumed by `--agent implement-agent`. |
| `.atw/config.yaml` (`channel.*` block) | Worker guard thresholds and channel defaults. |

The project bucket name is derived from the absolute project path (slashes flattened, non-alphanumerics replaced with `-`), matching Claude Code's `~/.claude/projects/<sanitized-cwd>/` convention. Override with `ATW_CHANNEL_ROOT` (root directory) or `ATW_CHANNEL_PROJECT` (bucket name) for testing or sandboxing.

## When To Reach For The Channel Runtime

Channels are heavier than a single Bash call or a one-shot sub-agent dispatch. Use them only when at least one of these conditions holds:

- The work needs **two or more agents to converse** through more than one turn (cross-AI brainstorm, peer review, dispatcher + worker).
- A worker should run as a **peer process** that the main session can interrupt, watch progress on, or wait for asynchronously.
- The conversation must be **durable and inspectable** later (forum/thread channels, issue boards, decision trails).
- Multiple workers must **share an event log** so each can see what the others reported.

Prefer cheaper primitives when:

- A single-shot Bash command or single Agent tool call is enough -> do that directly.
- The user just needs a static review against a file -> read the file and reply inline.
- The need is "remember what we discussed last week" -> use `atw mem` instead of a channel.

## Customization Points

| Need | Edit location |
| --- | --- |
| Change default channel worker idle timeout | `channel.worker_guard.idle_timeout` in `.atw/config.yaml`. Accepts `5m`, `30s`, etc. Set `0` to disable idle cleanup. |
| Change live worker budget | `channel.worker_guard.max_live_workers` in `.atw/config.yaml`. Set `0` to disable the spawn-time budget check. |
| Override worker guard per spawn | Pass `--idle-timeout` / `--max-live-workers` on `atw channel spawn`, or set `ATW_CHANNEL_WORKER_IDLE_TIMEOUT` / `ATW_CHANNEL_MAX_LIVE_WORKERS` in the environment. |
| Change what the default Review or Implement worker does | Edit `.atw/agents/review.md` or `.atw/agents/implement-agent.md`. These are platform-agnostic role cards; the channel runtime injects them when `--agent review|implement-agent` is passed. |
| Add a new role card | Drop `<name>.md` into `.atw/agents/`. `atw channel spawn --agent <name>` will pick it up. |
| Relocate channel storage (CI sandbox, ephemeral runs) | Set `ATW_CHANNEL_ROOT=/path/to/dir`. Channel events move with it; existing channels stay at the old root. |
| Switch storage scope | Pass `--scope project` (default) or `--scope global` on every channel subcommand. The bucket directory changes; nothing else does. |

Precedence for the worker guard is: CLI flag > environment variable > `.atw/config.yaml` > built-in default. Built-in defaults are `idle_timeout: 5m` and `max_live_workers: 6`.

## Relationship To Other Local Layers

- **Workflow layer**: workflows that use channel dispatch instruct the main agent to call `atw channel spawn --agent review` or `--agent implement-agent` instead of a platform sub-agent. If `.atw/agents/review.md` or `implement-agent.md` is missing, `atw workflow --template <id>` prints a non-blocking warning at install time. Restore them with `atw update` if they are deleted by accident.
- **Task layer**: channel workers do not own task state. The supervising main session passes the active task path through the worker inbox; the worker resolves task artifacts from disk.
- **Spec layer**: workers read `.atw/spec/` the same way the main session does. Channel runtime does not bypass spec context loading.
- **Platform integration layer**: channel runtime is platform-neutral. It does not depend on `.claude/`, `.codex/`, or any other platform directory. The adapters that normalize provider output (Claude `stream-json`, Codex `app-server`) live inside the ATW CLI binary, not in the project.
- **Platform sub-agent files vs. channel workers**: editing `.claude/agents/atw-implement-agent.md` (and its peers in other platform `.X/agents/` directories) does NOT change channel-runtime worker behavior — channel workers load `.atw/agents/<name>.md`. The platform-specific agent files are for direct sub-agent dispatch from the main AI session, not for channel-spawned workers. See `platform-files/agents.md` for the per-platform agent surface, and the `atw-meta/SKILL.md` rule that codifies this split.

## Runtime Usage

For command syntax, forum/thread patterns, worker handles, progress inspection, and the `--kind done` / `--kind turn_finished` dispatcher wait pattern, load the bundled `atw-channel` skill (auto-installed under each platform's skills directory after `atw init` / `atw update`). This reference only covers the local file layout and customization knobs; it does not duplicate command syntax that may change between releases.
