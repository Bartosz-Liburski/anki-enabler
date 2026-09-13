# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Rollout status reconciliation is not automatic

- **Context**: `context/foundation/test-plan.md` §3 (Phased Rollout status table)
- **Problem**: A rollout phase's `plan.md` can reach full Progress completion (all items `[x]`, `change.md` status `implemented`/`impl_reviewed`) while `test-plan.md` §3's Status column for that row still reads a stale value (e.g. "change opened") — `/10x-implement` and `/10x-impl-review` never touch §3, and nothing automatically triggers a `/10x-test-plan` re-run when a phase finishes.
- **Rule**: _(fill in)_
- **Applies to**: _(fill in)_
