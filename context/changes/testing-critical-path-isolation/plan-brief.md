# Critical-Path: Isolation & Silent-Failure Testing — Plan Brief

> Full plan: `context/changes/testing-critical-path-isolation/plan.md`

## What & Why

Bootstrap the project's first automated test runner and prove the two highest-priority risks from `test-plan.md` are covered: cross-user data access (IDOR) and silent failure states. The app has zero test infrastructure today; this phase both stands up Vitest and closes two real gaps discovered while researching the RLS/failure-handling surface.

## Starting Point

Authorization is 100% RLS-dependent (one policy per table, 4 untested Storage policies); `isolation.sql` is a hand-rolled `DO` block, not real pgTAP, run against the hosted project. Failure-state handling is already strong (compiler-enforced code→message maps), with two confirmed gaps: an export-banner that can silently drop, and unguarded `formData()` parsing on 4 routes.

## Desired End State

Vitest is wired up as `npm run test`; `isolation.sql` is real pgTAP covering all table AND Storage-bucket policies; both silent-failure gaps are fixed and regression-tested; 5 IDOR integration tests prove RLS holds at the application layer; `test-plan.md` §6 documents how to add each kind of test going forward.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|----------|--------|-------------------|--------|
| RLS test execution | Hosted-linked, upgraded to real pgTAP | No Docker needed anywhere; matches the project's existing "no local stack" decision | Plan |
| Export-banner gap | Fix now | 1-line-scope fix, satisfies the PRD's explicit "never silent" requirement | Plan |
| formData() gap | Fix now | Small, mechanical, closes a real unhandled-exception surface | Plan |
| App-layer ownership checks | Test-only, don't add | Matches the codebase's own stated convention that RLS is the sole authz boundary | Plan |
| Storage-policy test depth | All 4 operations | Partial coverage would leave 3/4 policies unverified | Plan |
| CI wiring | Deferred to rollout Phase 4 | Matches test-plan.md's own phase sequencing | Plan |
| Export-banner fix approach | Broaden the render condition | Matches the PRD's literal "never silent" requirement independent of other page state | Plan |

## Scope

**In scope:** Vitest bootstrap, pgTAP conversion + Storage coverage, export-banner fix, formData() guard on 4 routes, 5 IDOR integration tests, test-plan.md §6 update.

**Out of scope:** App-layer defense-in-depth ownership checks, CI wiring, local Docker/`supabase start`, Risks #3–#6 (CSV integrity, deletion cleanup, generation direction, guardrails — later rollout phases).

## Architecture / Approach

Vitest (via Astro's `getViteConfig()`) for unit + integration tests; real pgTAP (transactional `begin/plan/finish/rollback`) run via the existing `supabase db query --linked` mechanism for RLS/Storage proof. A shared fixture helper seeds two real users against the hosted project for integration tests, mirroring how a live request actually authenticates.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|-------|-------------------|----------|
| 1. Bootstrap test infrastructure | Vitest + shared test-user fixture helper | Astro env/path-alias resolution under Vitest |
| 2. RLS + Storage-bucket pgTAP suite | Real pgTAP, all 4 Storage policies covered | Transaction-rollback correctness against hosted DB |
| 3. Close silent-failure gaps | Export-banner fix + formData() guard, regression-tested | Visual regression in the broadened export section |
| 4. IDOR integration tests | 5 cross-user-access tests | Astro 6 Container API `ssr`-environment requirement |
| 5. Cookbook update | test-plan.md §6 filled in | — |

**Prerequisites:** none beyond what's already in the repo (hosted Supabase project linked, Anthropic API key not required for this phase).
**Estimated effort:** ~1-2 sessions across 5 phases.

## Open Risks & Assumptions

- Enabling the `pgtap` extension inside a rolled-back transaction on the hosted project is assumed safe (standard Supabase-documented pattern); verify empirically in Phase 2's manual check.
- The Astro 6 Container API `ssr`-environment requirement (Phase 4) is based on a recent upstream GitHub issue, not yet reflected in stable docs — worth re-verifying if Astro is upgraded later.

## Success Criteria (Summary)

- `npm run test` and `npm run test:rls` both pass locally, covering RLS/Storage policies and both silent-failure fixes
- A second user's real session cannot reach a first user's data through any of the 5 tested routes/pages
- `test-plan.md` §6 gives a concrete answer for "how do I add a test for X" in this project
