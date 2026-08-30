---
change_id: testing-critical-path-isolation
title: Extend RLS isolation tests and fix silent failure states
status: implemented
created: 2026-08-21
updated: 2026-08-21
archived_at: null
---

## Notes

Rollout Phase 1 of `context/foundation/test-plan.md`: "Critical-path: isolation & silent-failure".

Risks covered:
- #2 — a route or Storage path lets one authenticated user read, modify, or delete another user's source, flashcards, or screenshot (IDOR).
- #1 — a generation/review failure (zero usable cards, mid-call error, missing config) shows a blank/silent result instead of an explanatory message.

Test types planned: pgTAP (RLS/isolation) + integration. Bootstraps Vitest as the project's first test runner.

Risk response intent:
- #2: prove a second authenticated user's session cannot read/write/delete a first user's source, flashcard, or screenshot via any route or Storage path. Must challenge "RLS alone covers it" — a helper using the service_role key bypasses RLS; Storage needs its own owner-path check independent of table RLS. Extend the existing `supabase/tests/isolation.sql` pgTAP pattern to current schema/routes.
- #1: prove every failure branch (zero cards, generation error, missing config) renders a visible explanatory message, never a blank result. Must challenge "the outcome-code redirect already covers this" — a branch can set a code with no rendered message behind it.

See `context/foundation/test-plan.md` §2 (Risk Map + Risk Response Guidance) and §3 (Phased Rollout, row 1) for full context.
