# Add a Screenshot Source and Set Its Learning Direction — Plan Brief

> Full plan: `context/changes/add-screenshot-source/plan.md`

## What & Why

Roadmap slice **S-01**. Let a signed-in user upload a screenshot image as a *source* and set
that source's learning direction — the foreign language being learned plus the language they
already know — persisting the image to Supabase Storage and the metadata to `sources`, with
the input size/format cap enforced before anything is stored. The stored, context-tagged
source is the exact input S-02 (generation) consumes, so this slice unblocks the north star.

## Starting Point

F-01 created `sources`/`flashcards` with per-user RLS, but `sources` has only `id`,
`user_id`, `created_at`. There is no Storage bucket, no upload code, and no domain API
endpoint anywhere — API routes are auth-only. The dashboard is a placeholder shell that
lists no data. UI has only `ui/button`; forms are progressive-enhancement HTML + a React
island with hand-rolled validation (no zod).

## Desired End State

On the dashboard, a user picks a png/jpeg ≤ 5 MB, chooses the learned and known languages
from dropdowns, and submits. The image lands privately in Storage under their own user-id
path, a `sources` row records `type`, `image_path`, and the language pair, and they return
to the dashboard with a confirmation. Oversized/wrong-format files are rejected before any
storage. No user can reach another's row or image.

## Key Decisions Made

| Decision                    | Choice                                        | Why (1 sentence)                                                              | Source |
| --------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| Known-language cardinality  | Single `known_language` (text)                | Matches the concrete persona; simplest schema/form/prompt for v1.            | Plan   |
| Language input              | Curated dropdown (shadcn Select)              | Normalized values S-02's generation can rely on; better UX than free text.   | Plan   |
| `type` column               | Added now, default `'screenshot'`             | Makes S-05 (plain-text) a purely additive follow-on; F-01 anticipated it.    | Plan   |
| Size cap                    | 5 MB                                          | Fits real screenshots while bounding the S-02 vision cost.                   | Plan   |
| Accepted formats            | PNG + JPEG only                               | Covers ~all screenshots; matches the bucket allowlist for server enforcement.| Plan   |
| Cap enforcement             | Client + endpoint + bucket (one constant)     | Defense in depth; NFR holds even if the client is bypassed.                  | Plan   |
| UI home                     | Inline on the dashboard                       | Gives the placeholder dashboard its first real interaction.                  | Plan   |
| Post-create UX              | Redirect to dashboard with confirmation       | Browse/list stays S-04; smallest slice, reuses `?success=`/`?error=`.        | Plan   |

## Scope

**In scope:** additive `sources` migration (type, image_path, learned/known language);
private `screenshots` Storage bucket + owner-path Storage RLS; `POST /api/sources` upload
endpoint with size/format validation; inline dashboard upload form; regenerated types + typed
client.

**Out of scope:** flashcard generation (S-02); source browsing/listing/deletion (S-04);
plain-text sources (S-05); multiple known languages; image processing; a test framework.

## Architecture / Approach

One additive migration extends `sources` and provisions the private bucket + Storage RLS in
the same file; types are regenerated and the shared client typed with `<Database>`. A new
`POST /api/sources` (existing `formData()` + redirect convention) auth-guards, validates
against a shared limit constant, uploads to `{user_id}/{id}.{ext}`, inserts the row, and
redirects with a success/error signal. The dashboard mounts a `client:load` island that
fast-fails client-side then lets the browser POST natively.

## Phases at a Glance

| Phase                    | What it delivers                                             | Key risk                                                        |
| ------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------- |
| 1. Data layer            | `sources` columns + private bucket + Storage RLS + types    | Storage RLS path convention wrong → isolation gap or write fails |
| 2. Upload endpoint       | `POST /api/sources`: validate → upload → insert → redirect  | Upload/insert ordering leaves an orphaned object on failure     |
| 3. Dashboard upload form | Inline form island + success/error surfacing                | Missing shadcn primitives; file-input + validation UX          |

**Prerequisites:** F-01 landed (it has); `SUPABASE_KEY` must be the anon/publishable key
(carried-forward F-01 follow-up); Supabase CLI linked to the hosted project.
**Estimated effort:** ~2–3 focused sessions across the 3 phases.

## Open Risks & Assumptions

- **`SUPABASE_KEY` may still be the DB password, not the anon key** (F-01's open follow-up).
  RLS and Storage RLS both depend on the anon key; upload/isolation can't be trusted until
  it's fixed.
- **Storage RLS is verified manually** — no test runner. A wrong path prefix silently breaks
  isolation, so the two-user manual check is load-bearing.
- **`NOT NULL` language columns are safe only because `sources` is empty** — a populated
  table would need a backfill/default first.

## Success Criteria (Summary)

- A user can add a screenshot source with a learning direction and see it confirmed.
- Oversized/wrong-format uploads are rejected before any storage, with a clear message.
- No user can read another user's source row or stored image (table + Storage RLS).
