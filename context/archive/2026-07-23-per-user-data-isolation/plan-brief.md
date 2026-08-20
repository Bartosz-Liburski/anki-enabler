# Per-user Data Isolation for Sources & Flashcards — Plan Brief

> Full plan: `context/changes/per-user-data-isolation/plan.md`

## What & Why

Create the first Supabase migration for Anki-enabler: `sources` and `flashcards` tables,
owned per user and protected by RLS so a signed-in user can only touch their own rows. This
is foundation slice **F-01** — it establishes the isolation contract every data-writing slice
builds on, and the verification path for the launch-gating NFR: *a user's sources and
flashcards are never visible to any other user.*

## Starting Point

Auth is already complete and RLS-ready: `src/lib/supabase.ts` builds a per-request cookie
client on the anon key, so DB calls run as the authenticated user and **RLS is the real
enforcer**. The database itself is greenfield — `supabase/` has only config, no
`migrations/`, no tables. There is no local Supabase stack (hosted cloud project) and no test
runner; project checks are `astro check` + `eslint` only.

## Desired End State

Two RLS-protected tables exist on the hosted project. No query path (read/insert/update/
delete) lets one user reach another's rows. Deleting a source cascades to its flashcards;
deleting an account cascades to its data. `src/db/database.types.ts` holds generated types,
and a committed SQL script (`supabase/tests/isolation.sql`) proves the isolation NFR
repeatably and passes green.

## Key Decisions Made

| Decision                       | Choice                                              | Why (1 sentence)                                                              | Source |
| ------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------- | ------ |
| Schema scope                   | Isolation contract only (ids, user_id, FKs, timestamps) | Roadmap scopes F-01 to "the two tables the first slice needs"; slices add columns. | Plan |
| RLS policy shape               | Single `FOR ALL` policy per table (USING + WITH CHECK) | Simplest complete cover for a flat user model; minimal audit surface.         | Plan |
| Isolation verification         | Committed SQL script run via Supabase CLI           | Repeatable + reviewable, guards the top risk, no test framework introduced.    | Plan |
| Image storage bucket           | Deferred to S-01                                    | Roadmap scopes F-01 to two tables; S-01 owns upload.                          | Plan |
| TypeScript types               | Generate via `supabase gen types` → `src/db/database.types.ts` | Type-safe from slice 1; sets the convention while the schema is tiny.          | Plan |
| flashcards → sources           | Denormalized `user_id` + `source_id` FK `ON DELETE CASCADE` | Keeps flashcards RLS a join-free check; DB-guarantees FR-006 cascade.          | Plan |
| Account deletion               | `user_id` → `auth.users(id)` `ON DELETE CASCADE`    | No orphaned PII; referential integrity enforced by Postgres.                  | Plan |

## Scope

**In scope:** first migration (both tables, cascade FKs, RLS + one policy each), generated TS
types, documented migration/regenerate ritual, repeatable SQL isolation test.

**Out of scope:** feature columns (learning direction, image path, card front/back, status),
storage bucket, query/repository layer, test framework, app UI/endpoints, down migrations,
deck/grouping table.

## Architecture / Approach

One forward-only SQL migration creates both tables with `ON DELETE CASCADE` foreign keys
(to `auth.users` and, for flashcards, to `sources`), enables RLS on both, and installs a
single `FOR ALL` policy per table checking `auth.uid() = user_id` in USING and WITH CHECK.
Types are generated from the applied schema. A committed SQL script impersonates two users via
JWT claims and asserts the boundary on every CRUD path. No application code changes beyond the
generated types file — the per-request RLS-respecting client already exists.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema & RLS migration + types | First migration (tables, cascade FKs, RLS policies) + generated `database.types.ts` | `SUPABASE_KEY` being the service_role key would silently bypass RLS |
| 2. Repeatable isolation verification | `supabase/tests/isolation.sql` proving no cross-user CRUD path | A vacuously-passing script that doesn't actually catch a leak |

**Prerequisites:** a linked hosted Supabase project (`supabase link`); confirmation that
`SUPABASE_KEY` is the anon/publishable key.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Assumes `SUPABASE_KEY` is the anon key — if it's service_role, RLS is bypassed and every
  isolation result is meaningless (Phase 1 manual check exists to catch this).
- Verification runs against the hosted project (no local stack); JWT-claim impersonation SQL
  must be authored carefully so `auth.uid()` resolves correctly.
- Migrations are forward-only — no rollback path if a policy is wrong; the weakened-policy
  manual check exists to catch a false-green script before it matters.

## Success Criteria (Summary)

- Two RLS-protected tables applied to the hosted project; `astro check` + lint green.
- The isolation SQL script passes, and provably fails when a policy is weakened.
- Source→flashcards and account→data cascades both confirmed.
