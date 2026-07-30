# Add a Screenshot Source and Set Its Learning Direction — Implementation Plan

## Overview

Roadmap slice **S-01**. Let a signed-in user upload a screenshot image as a *source* and
set that source's **learning direction** — the foreign language being learned plus the
language they already know — persisting the image to Supabase Storage and the metadata to
the `sources` table, with the input **size/format cap** enforced *before* anything is
stored. The stored, context-tagged source is the input that S-02 (generation) consumes.

This is the first slice that writes user-owned feature data. It stands up three surfaces the
project does not yet have: the first **additive feature migration** on top of F-01's tables,
the first **Supabase Storage bucket** (with its own Storage RLS), and the first **domain API
endpoint / file upload** — plus the dashboard's first real interaction.

## Current State Analysis

- **The DB foundation is ready but bare.** F-01's migration
  (`supabase/migrations/20260723162258_init_sources_flashcards.sql:18-25`) created
  `public.sources` with only `id`, `user_id`, `created_at` and a per-user owner-all RLS
  policy (`sources_owner_all`, `auth.uid() = user_id` in both `USING` and `WITH CHECK`). Its
  own comment states feature columns (*"type, learning direction, image path"*) are added by
  later slices via **additive** migrations — do not edit that file.
- **Migrations are forward-only / additive** (`infrastructure.md:99`): a Vercel code rollback
  does not revert an applied schema migration, so no down path is written.
- **Storage is entirely greenfield.** No bucket and no upload code exist anywhere in `src/`.
  `supabase/config.toml:109-119` enables Storage (`file_size_limit = "50MiB"`) and carries a
  **commented-out** private `images` bucket template (`public = false`, png/jpeg allowlist).
  Infra guidance is explicit: images go **straight to Supabase Storage**; the serverless
  function stays orchestration-only (`infrastructure.md:116`).
- **This is the first domain endpoint.** Existing API routes are auth-only, `POST`-only,
  typed `export const POST: APIRoute = async (context) => {…}`, read `await
  context.request.formData()`, build a **per-request** client via
  `createClient(context.request.headers, context.cookies)`, and respond with
  `context.redirect("…?error=…")` — there is no JSON API pattern
  (`src/pages/api/auth/signup.ts`). Multipart file upload fits this `formData()` convention.
- **API routes are not gated by middleware.** `src/middleware.ts:4` only protects
  `/dashboard`; `/api/*` routes must check `context.locals.user` themselves.
- **The Supabase client is currently untyped.** `src/lib/supabase.ts:9` calls
  `createServerClient(…)` without the `<Database>` generic, so DB calls are untyped today.
- **UI primitives are thin.** Only `src/components/ui/button.tsx` is installed — no Input,
  Label, or Select. The reusable form pattern to model on: progressive-enhancement HTML
  `<form method="POST" action="/api/…">` + a `client:load` React island with **hand-rolled**
  validation (no zod, no react-hook-form), plus `FormField.tsx`, `SubmitButton.tsx` (uses
  `useFormStatus()`), and `ServerError.tsx` (`src/components/auth/`).
- **The dashboard is a placeholder shell.** `src/pages/dashboard.astro` reads
  `Astro.locals.user`, shows the email and a sign-out form, and lists **no** data. Auth pages
  read `error` from URL query params (`src/pages/auth/signin.astro:5`) — the established
  success/error surfacing convention.
- **No test runner exists.** Project checks are `npx astro sync && npx astro check && npm run
  lint` only. F-01's `supabase/tests/isolation.sql` is the isolation regression guard.

## Desired End State

A signed-in user, on the dashboard, can:

- Set the **learning direction once** — the language being learned plus the language they
  already know, from curated dropdowns — and then add **many** screenshots to that pair in a
  row without re-picking it. The pair survives closing the tab; `Change` returns to the
  picker.
- Pick a screenshot (png/jpeg, ≤ 5 MB) for the selected pair and submit.
- On success, land back on the dashboard **with the pair still selected** and a confirmation;
  the image is stored privately in Supabase Storage under their own user-id path, and a
  `sources` row records `type='screenshot'`, `image_path`, `learned_language`,
  `known_language`, and `user_id`.
- On a too-large or wrong-format file, be rejected **before** any upload/insert, with a
  clear message — the size/format cap is honored at the client, the endpoint, and the bucket.
- Never reach another user's sources or stored images (per-user RLS on the table + owner
  path-scoped Storage RLS on the bucket).

**How to verify:** upload a valid screenshot → confirm the `sources` row and the stored
object under `{user_id}/…`; attempt a 6 MB file and a `.gif` → both rejected with a message,
no row/object created; sign in as a second user → cannot list the first user's row or object.

### Key Discoveries:

- `sources.user_id` FK + RLS already enforce ownership; the new migration only **adds
  columns** and the bucket — it does not touch the existing table policy
  (`supabase/migrations/20260723162258_init_sources_flashcards.sql:33-38`).
- Storage RLS is separate from table RLS: policies live on `storage.objects`, scoped by the
  first path segment (`(storage.foldername(name))[1] = auth.uid()::text`), so an owner-path
  convention `{user_id}/{source_id}.{ext}` is what makes the bucket per-user-isolated.
- The app connects with the **anon** key so RLS applies to both table and Storage writes;
  the per-request client already rides the user's cookie session
  (`src/lib/supabase.ts`, `src/middleware.ts`).
- `database.types.ts` is regenerated from the applied schema (`supabase gen types`) — it must
  be regenerated after the migration or new-column inserts won't type-check.

## What We're NOT Doing

- **No flashcard generation** (S-02) — no LLM SDK, no vision call, no `flashcards` writes.
- **No source browsing / listing / deck view** (S-04, FR-005/FR-011) — after create we
  redirect with a confirmation; the dashboard does not render a list of existing sources.
- **No source deletion / cascade** (S-04, FR-006).
- **No plain-text source path** (S-05, FR-004) — but the `type` column is added now with a
  `'screenshot'` default so S-05 is a purely additive follow-on.
- **No source editing** (PRD Non-Goal) — sources are add-only here.
- **No `decks` table** — the language pair is a *selection* (URL param + recall cookie), not a
  persisted entity. Every source still carries its own pair columns, per the roadmap's
  "per-source learning direction". A real deck entity belongs to S-04.
- **No source count / list for the selected pair** — that is listing, which S-04 owns.
- **No multiple known languages** — a single `known_language` per source (decision below).
- **No image processing** — no resize/thumbnail/OCR; the file is stored as-is.
- **No new test framework** — verification is `astro check` + `lint` + the manual steps.
- **No low-confidence text-extraction warning** (FR-003 guardrail) — that is a
  generation-time concern owned by S-02.

## Implementation Approach

A single additive migration extends `sources` with the feature columns and, in the same
file, provisions a private `screenshots` bucket plus owner-path-scoped Storage RLS policies;
types are then regenerated and the shared client is typed with `<Database>`. A new
`POST /api/sources` endpoint (following the existing `formData()` + redirect convention)
auth-guards, validates size/format against a **single shared limit constant**, uploads the
file to `{user_id}/{id}.{ext}`, inserts the row, and redirects to the dashboard with a
success or error signal **plus the language pair**. Finally, the dashboard splits into two
steps: a pair picker that submits as a plain `GET` to `/dashboard`, and — once the URL carries
a valid pair — an upload island that fast-fails on size/format client-side before the native
POST. The URL is the rendering source of truth; middleware mirrors the pair into a cookie for
recall, and the page reads `?success=`/`?error=` to surface the outcome.

## Amendments During Implementation

Recorded after the fact, on the user's instruction, so the plan matches what shipped:

1. **Two separate steps instead of one form.** The pair is chosen first and then takes many
   uploads in a row (user request). Mechanism: step 1 is a `GET` form to `/dashboard` whose
   field names *are* the query-param names, so no mapping code exists; `POST /api/sources`
   echoes the pair on every redirect. A cookie (`anki_source_pair`, re-validated on read)
   restores the pair after a tab close. No schema change — `sources` keeps its own pair columns,
   so the roadmap's "per-source learning direction" still holds and no `decks` entity appears.
2. **No shadcn Input/Label/Select.** The existing auth forms use hand-rolled styled native
   inputs (`FormField.tsx`), not shadcn primitives, so Radix Select would have made the two
   language fields behave unlike every other field in the app — and it needs JS to pick a value,
   breaking the progressive-enhancement fallback this plan leans on. Native `<select>` /
   `<input type="file">` under `src/components/sources/` instead; no new dependency.
3. **Pair recall lives in middleware, not the page.** `return Astro.redirect(...)` in `.astro`
   frontmatter crashes ESLint — `@typescript-eslint/no-misused-promises` hits a top-level
   `return` with no parent node (`Non-null Assertion Failed`). Middleware is an ordinary
   function, so the redirect is safe there, and the page then renders from the URL alone.
4. **Outcome codes are a shared module** (`src/lib/source-errors.ts`) rather than string
   literals duplicated between the endpoint and the dashboard, so a renamed code fails type
   checking instead of silently rendering an empty banner.
5. **`Leave dashboard` link added** (to `/`), alongside the existing sign-out.

## Critical Implementation Details

- **Upload-then-insert ordering + orphan handling.** Generate the source `id` in the
  endpoint, upload the object to `{user_id}/{id}.{ext}` first, then insert the `sources` row
  carrying that `id` and `image_path`. If the insert fails, best-effort delete the just-
  uploaded object so a failed create doesn't leave an orphaned file; if the upload fails,
  never insert. This ordering keeps `image_path` accurate and avoids a row pointing at a
  missing object.
- **One shared limit constant, three enforcement points.** `MAX_UPLOAD_BYTES` (5 MB) and the
  accepted mime set (`image/png`, `image/jpeg`) live in one module and are imported by both
  the client island and the endpoint; the bucket's `file_size_limit` + `allowed_mime_types`
  mirror the same values as the last line of defense. The endpoint check is authoritative —
  the NFR ("rejected before any generation runs") must hold even if the client is bypassed.
- **Storage RLS is path-convention-dependent.** The owner-only Storage policies assume the
  object name's first folder segment is the owner's uid; the endpoint MUST write to
  `{user_id}/…` for the policy to admit the write and for isolation to hold.

## Phase 1: Data Layer — Migration, Storage Bucket, Types

### Overview

One additive migration adds the `sources` feature columns and provisions the private
`screenshots` bucket with owner-path-scoped Storage RLS; then regenerate the types and type
the shared Supabase client. After this phase the data layer is complete and type-safe.

### Changes Required:

#### 1. Additive migration: `sources` columns + `screenshots` bucket + Storage RLS

**File**: `supabase/migrations/<timestamp>_add_screenshot_source_fields.sql` (new)

**Intent**: Extend `sources` with the columns S-01 writes, and stand up a private image
bucket whose objects are readable/writable only by their owner — the storage counterpart to
the table's existing per-user RLS.

**Contract**:
- `alter table public.sources add column`:
  - `type text not null default 'screenshot'` with `check (type in ('screenshot','plaintext'))`
  - `image_path text` (nullable — plain-text sources in S-05 won't have one)
  - `learned_language text not null`
  - `known_language text not null`
- Optional integrity guard: `check (type <> 'screenshot' or image_path is not null)` so a
  screenshot row cannot exist without an image path.
- Provision a private bucket via `insert into storage.buckets (id, name, public,
  file_size_limit, allowed_mime_types) values ('screenshots','screenshots', false, 5242880,
  array['image/png','image/jpeg'])` (idempotent with `on conflict (id) do nothing`).
- Four owner-path-scoped policies on `storage.objects` for `bucket_id = 'screenshots'` (one
  each for select/insert/update/delete, `to authenticated`), gating on
  `(storage.foldername(name))[1] = auth.uid()::text` (insert uses `with check`). This is the
  load-bearing, non-obvious part — include it explicitly. No down path (forward-only).

#### 2. Uncomment the local `screenshots` bucket in `config.toml`

**File**: `supabase/config.toml`

**Intent**: Give local/CLI Supabase the same private bucket for dev parity with the hosted
project.

**Contract**: Add/uncomment a `[storage.buckets.screenshots]` block mirroring the migration
(`public = false`, `file_size_limit = "5MiB"`, `allowed_mime_types = ["image/png",
"image/jpeg"]`). Config only; the hosted bucket comes from the migration.

#### 3. Regenerate `database.types.ts`

**File**: `src/db/database.types.ts` (regenerated)

**Intent**: Reflect the new `sources` columns so endpoint inserts type-check.

**Contract**: Output of `supabase gen types typescript` for the linked project — `sources`
Row/Insert/Update now include `type`, `image_path`, `learned_language`, `known_language`. No
hand-edits.

#### 4. Type the shared Supabase client

**File**: `src/lib/supabase.ts`

**Intent**: Parameterize the client with the generated `Database` type so `sources` inserts
are checked against the schema.

**Contract**: `createServerClient<Database>(…)` importing `Database` from
`../db/database.types`. Signature and cookie wiring unchanged; return type is now typed.

### Success Criteria:

#### Automated Verification:

- Migration file exists: `ls supabase/migrations/*_add_screenshot_source_fields.sql`
- Migration applies cleanly to the linked project: `supabase db push`
- Types file reflects new columns: `grep -q learned_language src/db/database.types.ts`
- Type checking passes: `npx astro sync && npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- In Supabase Studio, `sources` shows the four new columns with the stated defaults/checks
- `screenshots` bucket exists, is **private**, with the 5 MB limit + png/jpeg allowlist
- `storage.objects` shows the four owner-scoped policies for the bucket
- `SUPABASE_KEY` in the environment is the anon/publishable key (RLS + Storage RLS depend on
  it; carried forward from F-01's open follow-up)

**Implementation Note**: After Phase 1's automated checks pass, pause for manual confirmation
(bucket privacy + policies + anon-key) before proceeding to Phase 2.

---

## Phase 2: Upload Endpoint

### Overview

Add the first domain endpoint, `POST /api/sources`, plus the shared upload-limit constant
and the curated language list it validates against. It auth-guards, validates, uploads, and
inserts, then redirects with a success/error signal.

### Changes Required:

#### 1. Shared upload-limit constant

**File**: `src/lib/upload-limits.ts` (new)

**Intent**: Single source of truth for the size/format cap so the client, the endpoint, and
(by mirror) the bucket agree.

**Contract**: Exports `MAX_UPLOAD_BYTES = 5 * 1024 * 1024` and `ACCEPTED_IMAGE_TYPES =
['image/png','image/jpeg']` (plus a human-readable label for messages). No logic.

#### 2. Curated language list

**File**: `src/lib/languages.ts` (new)

**Intent**: A fixed, normalized list of ~20–40 languages backing the Selects and validated
server-side, so stored values are consistent for S-02's generation prompt.

**Contract**: Exports an ordered array of language entries (a stable value + display label)
and a membership check the endpoint uses to reject values outside the list. The stored
`learned_language` / `known_language` are the entry's canonical value.

#### 3. Source creation endpoint

**File**: `src/pages/api/sources.ts` (new)

**Intent**: Accept the upload form, validate it, store the image and the row for the current
user, and redirect back to the dashboard with the outcome.

**Contract**: `export const POST: APIRoute`. Steps, in order:
- Build the per-request client (`createClient(context.request.headers, context.cookies)`);
  if null or `context.locals.user` is absent → redirect `"/auth/signin"`.
- Read `context.request.formData()`: `file` (File), `learned_language`, `known_language`.
- Validate **languages first** — both members of the curated list and not equal to each other —
  because every subsequent redirect echoes the pair back to the dashboard, and a redirect must
  not echo a pair it has not verified. Failures here → `redirect("/dashboard?error=<code>")`.
- Then validate the file: present; `file.size <= MAX_UPLOAD_BYTES`; `file.type` in
  `ACCEPTED_IMAGE_TYPES`. On failure → `redirect("/dashboard?<pair>&error=<code>")` **before**
  any upload/insert.
- Generate `id` (uuid); derive extension from mime; upload to the `screenshots` bucket at
  `${user.id}/${id}.${ext}` via `supabase.storage.from('screenshots').upload(...)`.
- Insert `sources` row `{ id, user_id: user.id, type: 'screenshot', image_path,
  learned_language, known_language }`. If insert fails → best-effort remove the uploaded
  object, then `redirect("/dashboard?<pair>&error=…")`.
- On success → `redirect("/dashboard?<pair>&success=source-added")` — carrying the pair is what
  leaves the next upload ready without re-picking it.

Error codes come from `src/lib/source-errors.ts` (added in Phase 3) and the dashboard URL is
built by `dashboardUrl()` from `src/lib/source-pair.ts`, so param names are spelled once.

Follows the existing auth-route shape (single `context` arg, `formData()`, redirect-based
responses) — no JSON responses.

### Success Criteria:

#### Automated Verification:

- Endpoint + helper files exist: `ls src/pages/api/sources.ts src/lib/upload-limits.ts src/lib/languages.ts`
- Type checking passes: `npx astro sync && npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- `curl -F` (or the Phase 3 form) with a valid png as an authenticated session creates a
  `sources` row and an object under `{user_id}/…` in the bucket
- A > 5 MB file and a `.gif` are each rejected with `?error=` and create **no** row/object
- An unauthenticated POST redirects to `/auth/signin`
- A deliberately failed insert leaves no orphaned object (cleanup path works)

**Implementation Note**: After Phase 2's automated checks pass, pause for manual confirmation
of the upload/validation/isolation behavior before proceeding to Phase 3.

---

## Phase 3: Dashboard Upload Form

### Overview

Give the dashboard its first real interaction, as **two steps**: pick the learning direction
once, then add as many screenshots to that pair as wanted. Client-side fast-fail on
size/format, outcome surfaced from the query param, and the pair remembered across tab closes.

### Changes Required:

#### 1. Native form primitives

**File**: `src/components/sources/{SelectField,FileField}.tsx` (new)

**Intent**: Provide the dropdown and file controls the two forms need, matching the app's
existing field look.

**Contract**: Hand-rolled, styled native `<select>` and `<input type="file">`, mirroring
`src/components/auth/FormField.tsx` (label, leading icon, error text, `cn()` variants). Native
rather than shadcn/Radix — see Amendment 2 — so the controls also carry their value when the
island has not hydrated. `FileField` renders `accept` from the shared constant and shows the
picked file's name/size; `accept` is a hint only, never a substitute for the real checks.

#### 2. Step 1 — language-pair picker

**File**: `src/components/sources/LanguagePairForm.tsx` (new)

**Intent**: Choose the learning direction, and put it in the URL so it can be carried forward.

**Contract**: A `client:load` island rendering `<form method="GET" action="/dashboard">` with
two `SelectField`s populated from `src/lib/languages.ts`. The field names are
`learned_language` / `known_language` — i.e. **the query-param names** — so the browser builds
`/dashboard?learned_language=…&known_language=…` with no mapping code and the step works with
JS disabled. `handleSubmit` blocks empty or identical pairs with inline errors. Prefills from
props so `?pair=change` can seed the previous values.

#### 3. Step 2 — upload island

**File**: `src/components/sources/AddSourceForm.tsx` (new)

**Intent**: Upload a screenshot into the already-chosen pair; ready for the next one right
after.

**Contract**: A `client:load` island rendering a real `<form method="POST"
action="/api/sources" encType="multipart/form-data" noValidate>`:
- The pair arrives via props and rides along as two `<input type="hidden">` fields, so the form
  holds **no** language state.
- One `FileField`; `handleSubmit` validates against `MAX_UPLOAD_BYTES` / `ACCEPTED_IMAGE_TYPES`
  (shared constant), `e.preventDefault()` + inline error on failure, otherwise the native POST
  proceeds.
- `ServerError` for the redirected error, `SubmitButton` for the pending state.

#### 4. Outcome codes module

**File**: `src/lib/source-errors.ts` (new)

**Intent**: One home for the `?error=` / `?success=` vocabulary shared by the endpoint and the
dashboard.

**Contract**: Exports the `SourceErrorCode` union, a `Record<SourceErrorCode, string>` message
map, the success code/message, and `sourceErrorMessage(code)` which falls back to a generic
message for an unrecognised (user-supplied) code rather than rendering an empty banner.

#### 5. Pair persistence + URL helpers

**File**: `src/lib/source-pair.ts` (new), `src/middleware.ts`

**Intent**: Let the chosen pair survive closing the tab, without giving the dashboard a second
source of truth to render from.

**Contract**: `source-pair.ts` exports `isValidPair`, the `anki_source_pair` cookie
read/write/clear helpers (`httpOnly`, `sameSite=lax`, `secure` in prod, 1-year `maxAge`), and
`dashboardUrl()` / `dashboardPairUrl()`. Cookie values are **re-validated** against the curated
list on read — a cookie is client-supplied. `middleware.ts`, for `/dashboard` only and *after*
the existing auth guard: `?pair=change` clears the cookie; a valid pair in the URL is written to
it; otherwise a remembered pair redirects to the canonical pair URL. Lives in middleware, not
the page — see Amendment 3.

#### 6. Two-step dashboard + outcome banners

**File**: `src/pages/dashboard.astro`

**Intent**: Branch on the pair, render the right step, and show the outcome.

**Contract**: Read `learned_language` / `known_language` from `Astro.url.searchParams` (mirroring
`auth/signin.astro:5`) — the URL is the only rendering input. Without a valid pair render
`<LanguagePairForm client:load />`; with one render a pair header (`Learning direction`,
`Spanish → Polish`) plus a `Change` link to `/dashboard?pair=change` and
`<AddSourceForm client:load />`. Show a green success banner from `?success=` and the error from
`?error=` (via `sourceErrorMessage`). Add a `Leave dashboard` link to `/` beside sign-out. No
source list or count is rendered (S-04 owns browse).

### Success Criteria:

#### Automated Verification:

- Components exist: `ls src/components/sources/{AddSourceForm,LanguagePairForm,SelectField,FileField}.tsx`
- Helpers exist: `ls src/lib/source-errors.ts src/lib/source-pair.ts`
- Type checking passes: `npx astro sync && npx astro check`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- The dashboard first shows the pair picker, and only then the upload form
- Selecting a > 5 MB file or a non-png/jpeg file shows an inline error and does **not** POST
- A valid submission creates the source and returns with the pair still selected + a success
  confirmation, ready for the next screenshot
- The success/error banner renders correctly from the `?success=`/`?error=` param
- The pair survives closing the tab; `Change` returns to the picker and stops remembering it
- `Leave dashboard` returns to the landing page
- No regression: sign-out and route protection on `/dashboard` still work

**Implementation Note**: After Phase 3 passes, S-01 is complete and S-02
(generate-and-review-cards) is unblocked.

---

## Testing Strategy

### Unit Tests:

- None — no test runner is introduced (consistent with F-01). Verification is `astro check` +
  `lint` + the manual steps below.

### Integration Tests:

- The end-to-end manual flow (upload → row + object → isolation) is the integration scenario.
  F-01's `supabase/tests/isolation.sql` continues to guard table-level RLS; the new columns
  and Storage policies are verified manually this slice.

### Manual Testing Steps:

1. Confirm `SUPABASE_KEY` is the anon key; apply the migration (`supabase db push`) and
   inspect the new columns + private bucket + Storage policies in Studio.
2. As user A, upload a valid png with a learned/known language pair; confirm the `sources`
   row and the object at `{userA}/…`.
3. Attempt a 6 MB file and a `.gif`: confirm inline client rejection, and (bypassing the
   client) confirm the endpoint also rejects with `?error=` and creates no row/object.
4. Sign in as user B: confirm B cannot select user A's `sources` row and cannot read user A's
   stored object (owner-path Storage RLS).
5. Confirm the dashboard success banner appears after a valid create, and route protection /
   sign-out still work.

## Performance Considerations

Negligible at MVP scale. The image is uploaded directly to Supabase Storage (the function
stays orchestration-only per `infrastructure.md:116`), so the endpoint does no heavy image
work. The 5 MB cap bounds both upload time and the downstream S-02 vision-model payload. The
existing `sources_user_id_idx` covers per-user access.

## Migration Notes

Forward-only and additive (`infrastructure.md:99`) — no down path. Existing `sources` rows
(none at MVP) would receive `type='screenshot'`; `learned_language`/`known_language` are
`NOT NULL` with no default, which is safe only because the table is empty — if rows existed,
the migration would need a backfill/default first. The bucket insert is idempotent
(`on conflict do nothing`). S-05 (plain-text) extends this additively using the `type` column.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-01, lines 81-92)
- PRD: `context/foundation/prd.md` FR-002, FR-003, Non-Functional Requirements (line 99)
- Infra: `context/foundation/infrastructure.md` (images straight to Storage, line 116;
  forward-only migrations, line 99)
- Prerequisite: `context/changes/per-user-data-isolation/plan.md` (F-01 schema + RLS)
- Existing migration (do not edit): `supabase/migrations/20260723162258_init_sources_flashcards.sql`
- Endpoint template: `src/pages/api/auth/signup.ts`; form template: `src/components/auth/SignUpForm.tsx`, `FormField.tsx`
- Storage bucket template: `supabase/config.toml:114-119` (commented)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data Layer — Migration, Storage Bucket, Types

#### Automated

- [x] 1.1 Migration file exists — 9203743
- [x] 1.2 Migration applies cleanly to the linked project (`supabase db push`) — 9203743
- [x] 1.3 Types file reflects new columns (`grep learned_language`) — 9203743
- [x] 1.4 Type checking passes (`astro sync && astro check`) — 9203743
- [x] 1.5 Linting passes (`npm run lint`) — 9203743

#### Manual

- [x] 1.6 `sources` shows the four new columns with defaults/checks in Studio — dcbae16
- [x] 1.7 `screenshots` bucket exists, is private, 5 MB + png/jpeg allowlist — dcbae16
- [x] 1.8 Four owner-scoped Storage policies present on `storage.objects` — dcbae16
- [x] 1.9 `SUPABASE_KEY` confirmed anon/publishable (not service_role) — dcbae16

### Phase 2: Upload Endpoint

#### Automated

- [x] 2.1 Endpoint + helper files exist — 58cb098
- [x] 2.2 Type checking passes (`astro sync && astro check`) — 58cb098
- [x] 2.3 Linting passes (`npm run lint`) — 58cb098

#### Manual

- [x] 2.4 Valid png creates a `sources` row + object under `{user_id}/…`
- [x] 2.5 Oversized file and wrong format each rejected with `?error=`, no row/object
- [x] 2.6 Unauthenticated POST redirects to `/auth/signin`
- [x] 2.7 Failed insert leaves no orphaned object (cleanup works)

### Phase 3: Dashboard Upload Form

#### Automated

- [x] 3.1 Form components exist (`AddSourceForm`, `LanguagePairForm`, `SelectField`, `FileField`)
- [x] 3.2 Helpers exist (`source-errors.ts`, `source-pair.ts`)
- [x] 3.3 Type checking passes (`astro sync && astro check`)
- [x] 3.4 Linting passes (`npm run lint`)
- [x] 3.5 Production build passes (`npm run build`)

#### Manual

- [x] 3.6 Pair picker shows first; upload form only after a valid pair
- [x] 3.7 Client fast-fails on oversized / wrong-format file without POSTing
- [x] 3.8 Valid submission creates the source and returns with the pair still selected + success
- [x] 3.9 Success/error banner renders from the query param
- [x] 3.10 Pair survives closing the tab; `Change` returns to the picker
- [x] 3.11 `Leave dashboard` returns to the landing page
- [x] 3.12 No regression: `/dashboard` protection and sign-out still work
