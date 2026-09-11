<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Critical-Path: Isolation & Silent-Failure Testing

- **Plan**: context/changes/testing-critical-path-isolation/plan.md
- **Scope**: Full plan (Phases 1–5, all complete)
- **Date**: 2026-08-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Test-fixture partial-failure can orphan a real hosted-project auth user

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/test/supabase-test-users.ts:69-106
- **Detail**: In `createSignedInUser`, if `admin.auth.admin.createUser` succeeds but the later `signInWithPassword` fails, the function throws without deleting the user it just created. `setupTestUsers` uses `Promise.all` over both users' setup — if user A's call fully succeeds while user B's rejects, the whole call rejects and the destructured `{userA, userB}` never binds, so no test's `afterAll(() => teardownTestUsers(userA, userB))` has a reference to delete anything. A transient network blip or rate-limit during either user's setup permanently orphans a real row in the hosted project's `auth.users` (email pattern `test-user-*@isolation.test`, harmless to app data but not self-cleaning).
- **Fix**: Capture each user's id the moment `createUser` succeeds, in a scope that survives a later throw in the same helper; delete it before rethrowing on any subsequent failure in that same user's setup. In `setupTestUsers`, switch `Promise.all` to `Promise.allSettled` (or sequential try/catch) so one call's failure can't strand the other's already-created user, and guard `teardownTestUsers` against partial/undefined input.
  - Strength: Closes the only failure path that leaves permanent state on the hosted project; the fix is confined to one file already designed around exactly this responsibility.
  - Tradeoff: A few more lines of defensive cleanup logic in a test-only helper.
  - Confidence: HIGH — the failure mode was verified empirically (agent confirmed Vitest still runs `afterAll` on a `beforeAll` throw; the bug is a hook with no reference to delete, not a skipped hook).
  - Blind spot: Doesn't cover an operator manually killing the test process mid-run (a different, unfixable-in-code failure mode) — acceptable, out of scope.
- **Decision**: FIXED — captured `userId` before the try/catch in `createSignedInUser`, delete-on-catch added; `setupTestUsers` switched to `Promise.allSettled` with cleanup of any succeeded user when the other fails. Verified: `npx astro check` 0 errors, lint 0 errors, `npm run test` 13/13.

### F2 — `teardownTestUsers` masks which user failed to delete

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/test/supabase-test-users.ts:109-113
- **Detail**: Uses `Promise.all` over the two `deleteUser` calls. If one rejects, the aggregate throws immediately without reporting which user succeeded — "one of two deleted" is indistinguishable from "both failed," so an operator can't tell which stray account (if any) needs manual cleanup.
- **Fix**: Switch to `Promise.allSettled`, then log/throw naming the specific user id(s) that failed.
- **Decision**: FIXED — `teardownTestUsers` now uses `Promise.allSettled` and throws naming each failed user id. Verified: `npx astro check` 0 errors, lint 0 errors, `npm run test` 13/13.

### F3 — `request-invalid` message breaks the established tone

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/source-errors.ts:45
- **Detail**: `"That request couldn't be read. Please try again."` is the only entry in `SOURCE_ERROR_MESSAGES` using "Please try again" — every neighboring message ends with a bare "Try again." or "— try again." with no "Please."
- **Fix**: `"That request couldn't be read. Try again."`
- **Decision**: FIXED. Verified: `npx astro check` 0 errors, lint 0 errors, `npm run test` 13/13.

### F4 — test-plan.md §3 still shows Phase 1 as "change opened"

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence (process, not code)
- **Location**: context/foundation/test-plan.md §3 (Phase 1 row) and header line
- **Detail**: Phase 5's own Contract explicitly forbade touching §3 in this edit (frozen-strategy boundary), so this is not drift against this plan — but it does mean the rollout orchestrator (`/10x-test-plan`) still needs a follow-up invocation to reconcile Phase 1's status to `complete` and advance the rollout, since that reconciliation is `/10x-test-plan`'s job, not `/10x-implement`'s.
- **Fix**: Run `/10x-test-plan` (no arguments) next — its lazy reconciliation will detect `plan.md`'s Progress is fully `[x]` and flip §3 accordingly.
- **Decision**: ACCEPTED-AS-RULE: "Rollout status reconciliation is not automatic" (see `context/foundation/lessons.md`). Fix not applied now — user will run `/10x-test-plan` separately.

## Verification

**Automated** (re-run at review time, all pass):
- `npm run test` — 10 files, 13 tests passed
- `npx astro check` — 0 errors, 0 warnings
- `npm run lint` — 0 errors, 0 warnings
- `npm run build` — succeeded
- `npm run test:rls` — 13/13 pgTAP assertions ok

**Manual** (all 6 Progress manual items are `[x]`; each has a corresponding explicit user confirmation earlier in this conversation — no rubber-stamping detected):
- 1.5, 2.3, 3.5, 3.6, 4.5, 5.2 — all confirmed by the user in-session before being checked off.
