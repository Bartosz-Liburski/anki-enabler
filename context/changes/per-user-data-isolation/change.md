---
change_id: per-user-data-isolation
roadmap_id: F-01
title: Per-user data isolation for sources & flashcards
status: implementing
created: 2026-07-23
updated: 2026-07-23
prd_refs:
  - FR-001
  - NFR (no cross-user access)
---

# Per-user data isolation for sources & flashcards

Foundation slice F-01. Stand up the `sources` and `flashcards` persistence in Supabase
Postgres with row-level per-user isolation enforced, so a signed-in user's data is
readable/writable only by them. Establishes the isolation contract and the two tables the
first feature slice (S-01) needs — not a complete data layer; S-01/S-02 add their own
columns via additive migrations.

See `plan.md` for the implementation contract and `plan-brief.md` for the two-page summary.
