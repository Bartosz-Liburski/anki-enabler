---
change_id: per-user-data-isolation
roadmap_id: F-01
title: Per-user data isolation for sources & flashcards
status: archived
created: 2026-07-23
archived_at: 2026-08-20T14:58:34Z
updated: 2026-08-20
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

## Follow-up (out of this change)

- ~~**`.env` `SUPABASE_KEY` is not a valid anon/publishable API key** (it looks like the DB
  password).~~ **Resolved 2026-07-26** — `.env` now holds the real `sb_publishable_…`
  anon/publishable key; verified against the live project (`auth/v1/health` 200; anon
  `rest/v1/sources` returns `[]`, confirming a valid anon key with RLS active). Manual
  check 1.6 is now ticked.

