# Workflows

Use these patterns by intent. Prefer durable channels for multi-round work and
`channel run` for one-shot questions.

## Pattern A: Multi-round Brainstorm

Use when the user says "和 codex/claude 讨论一下", "brainstorm", or "拉一个 agent
进来一起看".

```bash
atw channel create brainstorm-storage-layer --by main \
  --task .atw/tasks/05-XX-storage-adapter

atw channel spawn brainstorm-storage-layer \
  --agent architect --provider codex \
  --file .atw/tasks/05-XX-storage-adapter/prd.md \
  --as cx-arch --timeout 30m

atw channel send brainstorm-storage-layer \
  --as main --to cx-arch --text-file /tmp/brainstorm-r1.md

atw channel wait brainstorm-storage-layer \
  --as main --kind done --from cx-arch --timeout 10m
```

Do not stop after one answer. Read the answer, identify vague areas, send a
new probe, and repeat until the result is executable.

Minimum round structure:

1. Direction split: should this live in an existing mechanism or a new one?
2. MVP boundary: v1, v2, and what would force v2 back into v1.
3. Data contract: events, schema, metadata, state source of truth, compatibility.
4. CLI / UX contract: command names, flags, errors, defaults, ambiguity.
5. Cross-layer risk and tests: shared helpers, drift points, release-blocking tests.

Optional rounds:

- Operations: logs, debugging, stuck workers, kill/restart, recovery.
- Migration/release: breaking status, manifest, changelog, docs-site.
- Opposition review: ask the peer agent to argue against the current plan.

Every probe should request concrete file paths, commands, schema, rejected
alternatives, and release-blocking issues. Reject hedging when a decision is
needed.

## Pattern B: Implement / Review Agent

Use when the user asks to dispatch implementation or review work.

```bash
TASK=.atw/tasks/05-12-foo
atw channel create cr-foo --task "$TASK" --by main

atw channel spawn cr-foo \
  --agent review \
  --jsonl "$TASK/check.jsonl" \
  --file "$TASK/prd.md" \
  --cwd "$PWD" --timeout 15m

atw channel send cr-foo --as main --to review --text-file /tmp/cr-brief.md
atw channel wait cr-foo --as main --kind done --from review --timeout 15m
atw channel messages cr-foo --kind message --from review --tag final_answer
```

For implement work, use `--agent implement-agent` and send an implementation
brief. For review work, include the exact diff scope, relevant specs, and
validation already run.

## Pattern C: Parallel Reviewers

Use one channel and distinct worker names.

```bash
atw channel create cr-feature --by main --ephemeral

atw channel spawn cr-feature --agent review \
  --jsonl "$TASK/check.jsonl" --file "$TASK/prd.md" \
  --timeout 15m

atw channel spawn cr-feature --agent review --provider codex --as review-cx \
  --jsonl "$TASK/check.jsonl" --file "$TASK/prd.md" \
  --timeout 15m

atw channel send cr-feature --as main --to review --text-file /tmp/cr-brief.md
atw channel send cr-feature --as main --to review-cx --text-file /tmp/cr-brief.md
atw channel wait cr-feature --as main --kind done --from review,review-cx --all --timeout 15m
```

`--all` means every listed worker must emit a matching event.

## Pattern D: One-shot Worker

```bash
atw channel run --provider codex --message "say hi in 3 words" --timeout 1m
atw channel run --agent plan --message-file /tmp/plan-question.md --timeout 10m
```

On success, `run` removes the ephemeral channel. On error/timeout/killed, it
keeps the channel and prints the path for inspection.

## Pattern E: Forum Channel

Use for issue forums, topic-style feedback, release todos, agent findings, and
internal changelogs. Read `forum.md` for the full model.

## Pattern F: Take Over Existing Thread

If the user gives a forum/thread name, restore context yourself:

```bash
atw channel forum <board> --scope global
atw channel thread <board> <thread> --scope global --raw
atw channel context list <board> --scope global --thread <thread>
atw channel messages <board> --scope global --raw --thread <thread>
```

Output a constraint summary, not a transcript dump:

- user-level problem
- context files that affect this repo
- current-version versus future-version requirements
- whether current code/design satisfies it
- next action or comment to append
