# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo is **single-context**. The npm workspaces under `packages/` share one product vocabulary (codexhost), so there is no `CONTEXT-MAP.md` and no per-package `CONTEXT.md`.

## Before exploring, read these

- **`docs/project/领域术语表.md`** — this repo's glossary. It plays the role other repos give to a root `CONTEXT.md` and uses the same shape (`## Language`, terms with `_Avoid_:` lines).
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If `docs/adr/` doesn't exist, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `atw-domain-modeling` skill (reached via `atw-askme-with-docs` and `atw-improve-codebase-architecture`) creates it lazily when decisions actually get resolved.

Do **not** create a root `CONTEXT.md`. When `atw-domain-modeling` resolves a term, it goes into `docs/project/领域术语表.md` — two glossaries would drift apart.

## File structure

```
/
├── docs/
│   ├── project/领域术语表.md    ← glossary (the CONTEXT.md equivalent)
│   └── adr/                     ← architecture decisions, created lazily
└── packages/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `docs/project/领域术语表.md`. Don't drift to synonyms the glossary explicitly avoids — in particular, don't conflate Harness, Model, Provider, Account, or Billing Source.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `atw-domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
