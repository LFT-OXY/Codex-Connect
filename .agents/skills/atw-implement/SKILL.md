---
name: atw-implement
description: "根据一份规格说明书或一组工单，完成一项工作。"
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use `/atw-tdd` where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use `/atw-code-review` to review the work.

Work the findings before committing. Fix what the review raised, then re-run the tests it touched.

**If the review surfaces a hard problem, stop** — the spec is wrong or self-contradictory, the fix needs a decision nobody has made, or it reaches outside this ticket's slice. Don't paper over it and don't silently widen the scope to absorb it. Say what the finding is and what it blocks, and get the decision from the user before writing more code. If the answer changes what the work is supposed to do, that change lands in the spec via the step below, not only in the code.

Then use `/atw-update-spec` to fold what actually got built back into the spec. The next review's Spec axis compares code against the spec, so a spec that lags behind the code makes that axis meaningless.

Commit your work to the current branch.
