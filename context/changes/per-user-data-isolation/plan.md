# Per-user Data Isolation for Sources & Flashcards — Implementation Plan

## Overview

Create the first Supabase database migration for the Anki-enabler product: two tables,
`sources` and `flashcards`, owned per user and protected by Row-Level Security (RLS) so a
signed-in user can only read/write their own rows. This is roadmap slice **F-01**, the
foundation every subsequent data-writing slice (S-01 onward) builds on, and the slice that
establishes the verification path for the launch-gating NFR: *"a user's sources and
generated flashcards are never visible to any other user."*

The scope is deliberately minimal — the **isolation contract and two tables**, not a
complete data layer. Feature slices add their own columns later via additive migrations.

## Current State Analysis

- **Auth is complete and RLS-ready.** `src/lib/supabase.ts` builds a per-request
  `@supabase/ssr` cookie client with the anon `SUPABASE_KEY`; `src/middleware.ts:6-16`
  populates `context.locals.user` and gates `/dashboard`. Every DB call therefore rides the
  authenticated user's cookie session rather than a privileged key — meaning **RLS is the
  real enforcement mechanism**, and the infra pre-mortem's #1 risk (module-scope client
  leaking sessions) is already avoided by the existing per-request pattern.
- **The database is greenfield.** `supabase/` contains only `config.toml` and `.gitignore`.
  There is **no `supabase/migrations/` directory, no schema, and no tables.** This slice
  authors the very first migration and sets migration conventions for the project.
- **No local Supabase stack and no test runner.** The Dockerized local stack was dropped
  (`tech-stack.md:26-38`); Supabase runs as a **hosted cloud project**. Project checks are
  `npx astro sync && npx astro check && npm run lint` only — there is no Vitest/Playwright.
- **Migrations are forward-only / additive** (`infrastructure.md:99`): a Vercel code
  rollback does not roll back a schema migration, so migrations must never assume a down path.
- **The `supabase` CLI is a devDependency** (`package.json`) and `supabase/config.toml`
  (Postgres major_version 17) is committed, so `supabase link` + `supabase db push` and
  `supabase gen types` are available workflows.

## Desired End State

After this plan:

- `supabase/migrations/<timestamp>_init_sources_flashcards.sql` exists and, when applied to
  the hosted Supabase project, creates `sources` and `flashcards` with per-user RLS.
- A signed-in user can only see and mutate their own rows; there is **no** query path (read,
  insert, update, or delete) by which one user reaches another user's rows.
- Deleting a `sources` row cascades to its `flashcards`; deleting an `auth.users` account
  cascades to that user's `sources` and `flashcards`.
- `src/db/database.types.ts` holds generated TypeScript types for the schema, and the
  regenerate ritual is documented for future slices.
- `supabase/tests/isolation.sql` proves the isolation NFR repeatably via the Supabase CLI,
  passing green.

**How to verify:** run the isolation script (Phase 2) — it seeds two users, then asserts
that user B cannot select/insert/update/delete against user A's rows. All assertions pass.

### Key Discoveries:

- RLS enforcement hinges on `SUPABASE_KEY` being the **anon/publishable** key, not the
  `service_role` key — service_role bypasses RLS entirely (`src/lib/supabase.ts:9`).
- The per-request client pattern that RLS relies on already exists — no app-code change is
  needed for isolation beyond the generated types file.
- `auth.users` is Supabase's built-in auth table; foreign-keying `user_id` to it is the
  standard Supabase ownership pattern and enables `ON DELETE CASCADE` account cleanup.

## What We're NOT Doing

- **No feature columns.** No learning-direction fields, source type, image path, card
  front/back, or keep/discard status — S-01/S-02 add these via their own additive migrations.
- **No storage bucket.** The private images bucket + its Storage RLS is deferred to S-01,
  which owns upload.
- **No data-access / query helper layer.** No repository or query module — slices write their
  own queries against the generated types.
- **No test framework.** We do not introduce Vitest/Playwright; verification is a SQL script.
- **No app UI or endpoints.** F-01 is schema + verification only.
- **No down migrations.** Migrations are forward-only per infra guidance.
- **No deck/grouping table** (FR-011 is nice-to-have, out of this foundation).

## Implementation Approach

A single SQL migration creates both tables, their foreign keys (all `ON DELETE CASCADE`),
enables RLS, and installs one `FOR ALL` policy per table checking `auth.uid() = user_id` in
both `USING` (read/existing-row) and `WITH CHECK` (new/updated-row) clauses. Types are then
generated from the applied schema. Finally, a committed SQL test script impersonates two
distinct users through JWT claims and asserts the isolation boundary holds on every CRUD
path, giving a repeatable guard against the pre-mortem's top risk.

## Critical Implementation Details

- **`SUPABASE_KEY` must be the anon/publishable key.** RLS is the *only* thing standing
  between users; the `service_role` key bypasses all policies. Confirm the configured key is
  anon before trusting any isolation result — a passing app with the service_role key would
  hide a total isolation failure.
- **Both tables need `user_id` and RLS enabled independently.** `flashcards` carries its own
  `user_id` (denormalized) so its policy is a join-free `auth.uid() = user_id` check rather
  than an `EXISTS` subquery through `sources`. Enabling RLS without a policy denies all
  access; enabling RLS is required on *both* tables or the one left open leaks everything.
- **Verification runs against the hosted project.** With no local stack, apply the migration
  with `supabase db push` and run the isolation script through the Supabase CLI against the
  linked cloud project (or a disposable branch/project). Impersonation uses
  `set local role authenticated` + `set local request.jwt.claims` to set `auth.uid()`.

## Phase 1: Schema & RLS Migration + Generated Types

### Overview

Author the first migration creating both tables with cascade FKs and per-user RLS, apply it
to the hosted project, then generate the TypeScript types and document the regenerate ritual.

### Changes Required:

#### 1. Initial schema migration

**File**: `supabase/migrations/<timestamp>_init_sources_flashcards.sql` (new)

**Intent**: Create the two user-owned tables with the isolation contract and enable RLS so
per-user access is enforced at the database boundary.

**Contract**:
- `sources`: `id uuid pk default gen_random_uuid()`, `user_id uuid not null references
  auth.users(id) on delete cascade`, `created_at timestamptz not null default now()`.
- `flashcards`: `id uuid pk default gen_random_uuid()`, `user_id uuid not null references
  auth.users(id) on delete cascade`, `source_id uuid not null references sources(id) on
  delete cascade`, `created_at timestamptz not null default now()`.
- `alter table … enable row level security` on **both** tables.
- One policy per table: `create policy … for all using (auth.uid() = user_id) with check
  (auth.uid() = user_id)`.
- Index `user_id` on both tables and `source_id` on `flashcards` (RLS predicates + join key).

#### 2. Generated TypeScript types

**File**: `src/db/database.types.ts` (new, generated)

**Intent**: Produce the canonical typed schema so every future slice writes type-safe
queries; establishes the generation convention now while the schema is tiny.

**Contract**: Output of `supabase gen types typescript` for the linked project, committed as
`src/db/database.types.ts`. No hand-edits.

#### 3. Document the regenerate ritual + migration workflow

**File**: `CLAUDE.md` (or `AGENTS.md` if present) — a short "Database" note

**Intent**: Record the forward-only migration workflow (`supabase db push`) and the
"regenerate `database.types.ts` after every migration" ritual so slices don't re-derive it.

**Contract**: A brief prose section naming the commands and the anon-key requirement. No code.

### Success Criteria:

#### Automated Verification:

- [ ] Migration file exists: `ls supabase/migrations/*_init_sources_flashcards.sql`
- [ ] Migration applies cleanly to the linked project: `supabase db push`
- [ ] Types file exists and is non-empty: `test -s src/db/database.types.ts`
- [ ] Type checking passes: `npx astro sync && npx astro check`
- [ ] Linting passes: `npm run lint`

#### Manual Verification:

- [ ] Confirm `SUPABASE_KEY` in the environment is the anon/publishable key, not service_role
- [ ] In Supabase Studio, both tables show RLS **enabled** with exactly one policy each
- [ ] `database.types.ts` reflects both tables (`sources`, `flashcards`) with the expected columns

**Implementation Note**: After Phase 1's automated checks pass, pause for manual confirmation
(especially the anon-key check) before proceeding to Phase 2.

---

## Phase 2: Repeatable Isolation Verification

### Overview

Commit a SQL script that impersonates two users and asserts RLS blocks every cross-user CRUD
path — the launch-gating NFR's regression guard.

### Changes Required:

#### 1. Isolation verification script

**File**: `supabase/tests/isolation.sql` (new)

**Intent**: Prove, repeatably and reviewably, that no query path lets one user reach
another's rows — guarding the pre-mortem's #1 risk without introducing a test framework.

**Contract**: A SQL script that, within a transaction, seeds two users' rows, then switches
identity with `set local role authenticated` + `set local request.jwt.claims` (setting
`sub` to each user's uuid so `auth.uid()` resolves) and asserts:
- User B's `select` over `sources`/`flashcards` returns **zero** of user A's rows.
- User B cannot `insert` a row carrying user A's `user_id` (WITH CHECK rejects it).
- User B's `update`/`delete` targeting user A's rows affects **zero** rows.
- Each user sees exactly their own rows.
Failing assertions must `raise exception` so a non-zero/aborted run signals failure. Include a
header comment with the exact CLI invocation used to run it against the linked project.

#### 2. Reference the script from the DB docs

**File**: `CLAUDE.md` / `AGENTS.md` "Database" note (extend Phase 1's section)

**Intent**: Point future work at the isolation script as the canonical isolation check to
re-run after any schema/RLS change.

**Contract**: One line naming the script path and when to run it. No code.

### Success Criteria:

#### Automated Verification:

- [ ] Script file exists: `ls supabase/tests/isolation.sql`
- [ ] Script runs green against the linked project (all assertions pass, no exception raised)

#### Manual Verification:

- [ ] Deliberately weaken one policy (temporarily) and confirm the script **fails** — proving
      the assertions actually catch a leak, not just pass vacuously
- [ ] Confirm the source→flashcards cascade: deleting a seeded source removes its flashcards

**Implementation Note**: After Phase 2 passes, F-01 is complete and S-01 is unblocked.

---

## Testing Strategy

### Unit Tests:

- None — no test runner is introduced. The isolation SQL script is the verification artifact.

### Integration Tests:

- The `supabase/tests/isolation.sql` script is the end-to-end isolation scenario: two users,
  all four CRUD verbs, both tables.

### Manual Testing Steps:

1. Confirm `SUPABASE_KEY` is the anon key (not service_role).
2. Apply the migration to the hosted project (`supabase db push`) and inspect both tables in
   Studio for RLS-enabled + one policy each.
3. Run `supabase/tests/isolation.sql` against the linked project; confirm it passes.
4. Temporarily weaken a policy, re-run the script, confirm it fails; restore the policy.
5. Delete a seeded source; confirm its flashcards are gone (cascade).

## Performance Considerations

Negligible at MVP scale (small users, low QPS). The `user_id` indexes keep RLS predicate
evaluation and per-user listing efficient as row counts grow; the `source_id` index supports
the cascade and future per-source queries.

## Migration Notes

Forward-only and additive (`infrastructure.md:99`) — a Vercel code rollback does **not**
revert an applied schema migration, so this migration includes no down path. Future slices
extend these tables with their own additive migrations rather than editing this one.

## References

- Roadmap slice: `context/foundation/roadmap.md` (F-01, lines 66-77)
- PRD: `context/foundation/prd.md` FR-001, Non-Functional Requirements (line 98), Access Control
- Infra risk register: `context/foundation/infrastructure.md` (module-scope leak, line 109)
- Existing per-request client: `src/lib/supabase.ts`, `src/middleware.ts:6-16`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & RLS Migration + Generated Types

#### Automated

- [x] 1.1 Migration file exists
- [ ] 1.2 Migration applies cleanly to the linked project (`supabase db push`)
- [ ] 1.3 Types file exists and is non-empty
- [x] 1.4 Type checking passes (`astro sync && astro check`)
- [x] 1.5 Linting passes (`npm run lint`)

#### Manual

- [ ] 1.6 Confirmed `SUPABASE_KEY` is the anon/publishable key, not service_role
- [ ] 1.7 Both tables show RLS enabled with exactly one policy each in Studio
- [ ] 1.8 `database.types.ts` reflects both tables with expected columns

### Phase 2: Repeatable Isolation Verification

#### Automated

- [ ] 2.1 Isolation script file exists
- [ ] 2.2 Script runs green against the linked project (all assertions pass)

#### Manual

- [ ] 2.3 Weakened-policy run confirms the script actually fails (non-vacuous)
- [ ] 2.4 Source→flashcards cascade confirmed on delete
