# Critical-Path: Isolation & Silent-Failure Testing — Implementation Plan

## Overview

Rollout Phase 1 of `context/foundation/test-plan.md`. Bootstrap the project's first automated test runner, prove the RLS/Storage authorization boundary holds against cross-user access (Risk #2), and close two confirmed silent-failure gaps while proving every generation/review failure path renders a visible message (Risk #1).

## Current State Analysis

The project has **zero test infrastructure** — no Vitest, no `test` npm script, no CI test step. The one existing verification artifact, `supabase/tests/isolation.sql`, is a hand-rolled `DO $$...$$` block using `raise exception` assertions (not real pgTAP — no `plan()`/`ok()`/`finish()`), run via `npx supabase db query --file ... --linked` against the **hosted** Supabase project (the project deliberately dropped local Docker per `tech-stack.md`).

Authorization is **100% RLS-dependent**: one `for all` policy per table (`sources_owner_all`, `flashcards_owner_all`) plus 4 Storage policies on the private `screenshots` bucket (`screenshots_owner_select/insert/update/delete`, keyed on `(storage.foldername(name))[1] = auth.uid()::text`). `isolation.sql` covers the 2 table policies but has **zero coverage of the 4 Storage policies** — the largest gap. Every route except `review.ts` queries `.eq("id", id)` / `.eq("source_id", id)` with no `user_id` filter, trusting RLS alone; `review.ts`'s own comment frames its extra ownership check as "scoping, not the security boundary" — RLS is the codebase's deliberate, sole authorization mechanism.

Silent-failure handling is unusually mature already: `source-errors.ts` uses two compiler-enforced exhaustive `Record<Code, Message>` maps, so a code without a message is a build error, and `generate.ts`'s every branch resolves to a specific outcome code. Two real gaps survive:
1. The account-wide export failure banner (`/api/export.csv` → `dashboard.astro`) can render as dropped when the pair-recovery cookie is absent **and** the account has zero sources — `middleware.ts:78` falls through unchanged, and `dashboard.astro:222`'s render condition (`pairReady && (canExport || exportError)`) then hides the banner entirely.
2. `context.request.formData()` is unguarded on all 4 POST routes (`sources.ts:30`, `generate.ts:78`, `delete.ts:44`, `review.ts:36`) — a malformed multipart body throws before any `fail()` branch runs, producing Astro's default 500 page instead of the app's banner.

### Key Discoveries:

- RLS table policies: `sources_owner_all` / `flashcards_owner_all`, `for all`, `using/with check (auth.uid() = user_id)` (`supabase/migrations/20260723162258_init_sources_flashcards.sql:33-38,61-66`).
- Storage policies (untested today): `screenshots_owner_select/insert/update/delete` on `storage.objects`, predicate `(storage.foldername(name))[1] = auth.uid()::text` (`supabase/migrations/20260726105652_add_screenshot_source_fields.sql:51-74`).
- `src/lib/supabase.ts:6-25` builds a **per-request** client (not module-scope) — no `service_role` usage found anywhere in `src/` or `scripts/`.
- `src/middleware.ts:7` gates only `/dashboard` and `/sources`; every `/api/*` route self-checks `context.locals.user`.
- `astro.config.mjs:21-29` resolves env vars through the `astro:env/server` virtual module — Vitest must resolve or handle this for any module under test that imports it.
- `tsconfig.json:9-11` declares the `@/*` → `./src/*` path alias — Vitest must mirror it.
- Official Astro 6 guidance (verified via Exa, 2026-08-21): endpoints (`src/pages/api/*.ts`) test directly as plain functions returning a `Response`, no server needed; rendering `.astro` components via the Container API requires Vitest's `ssr` environment specifically (a recent Astro 6 regression, `withastro/astro#14895`, tightened this — `jsdom`/`happy-dom`/client environments are no longer safe for it).
- `scripts/eval-cards.ts` and `scripts/csv-smoke.ts` establish the project's existing verification philosophy: drive pure functions directly, bypass framework machinery, assert exact output — the pattern this plan's unit tests follow.
- Supabase CLI version drift: `package.json:59` pins `^2.23.4`; the locally-cached `npx` resolves `2.98.2`.

## What We're NOT Doing

- Not adding app-layer defense-in-depth ownership checks to the 5 RLS-only routes (confirmed: test-only — matches the codebase's own stated convention that RLS is the sole authorization boundary).
- Not wiring these tests into CI (confirmed: deferred to rollout Phase 4, "Quality-gates wiring," per `test-plan.md` §3/§5).
- Not switching to local Docker Postgres / `supabase start` (confirmed: stay hosted-linked, matching the project's existing "no local stack" decision).
- Not touching `scripts/eval-cards.ts` or `scripts/csv-smoke.ts` — those are Phase 3's territory in the rollout (translation-direction eval extension) and already-adequate smoke coverage, respectively.
- Not creating `supabase/seed.sql` — irrelevant to the hosted-linked pgTAP path chosen; only matters for the local-Postgres path we're not taking.
- Not covering Risks #3–#6 (CSV integrity, deletion/Storage cleanup, generation direction, guardrails) — those are rollout Phases 2–3.

## Implementation Approach

Bootstrap Vitest first since three of the four remaining phases depend on it. Extend the RLS proof (pgTAP conversion + Storage coverage) as a track independent of Vitest, since it's pure SQL executed via the Supabase CLI. Fix the two silent-failure gaps with the smallest change that closes them, each backed by a unit test on an extracted pure function rather than a full page render. Prove the IDOR boundary at the application layer with integration tests that call route handlers directly (or, for the one page-level case, via the Astro Container API) using real seeded test-user sessions against the hosted project — the same execution model `isolation.sql` already uses, just from the app's own call sites instead of raw SQL.

## Phase 1: Bootstrap Test Infrastructure

### Overview

Stand up Vitest as the project's first test runner, add a shared helper for seeding two real test users against the hosted-linked Supabase project and obtaining their session cookies, and reconcile the Supabase CLI version drift.

### Changes Required:

#### 1. Vitest configuration

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Configure Vitest using Astro's own `getViteConfig()` helper so it inherits the project's Vite config (path aliases, env handling) automatically, per official Astro 6 guidance.

**Contract**: Default `test.environment` stays `node` — nothing in Phase 1 needs a DOM (no React islands are under test; the one `.astro` page test in Phase 4 uses the Container API directly, not a DOM environment). Test file glob covers `src/**/*.test.ts` and `src/**/*.integration.test.ts`.

#### 2. Package scripts and dependencies

**File**: `package.json`

**Intent**: Add `vitest` as a devDependency and two scripts: `test` (`vitest run`, plain unit + integration) and `test:rls` (`supabase db query --file supabase/tests/isolation.sql --linked`, wrapping the existing hosted-linked execution model). Bump the pinned `supabase` devDependency to match the version actually in use (`2.98.2`) so `npm ci` and the locally-cached CLI agree.

**Contract**: `npm run test` and `npm run test:rls` become the two commands every later phase's Success Criteria reference.

#### 3. Shared test-user fixture helper

**File**: `src/test/supabase-test-users.ts` (new)

**Intent**: A helper that creates (or reuses) two real Supabase auth users against the hosted-linked project via the Supabase JS admin/auth APIs, signs each in, and returns a per-user `{ headers, cookies }` pair shaped exactly like what `createClient()` in `src/lib/supabase.ts` expects — so integration tests can build a real per-request client for "user A" and "user B" the same way a live request would. Also exports a teardown function that deletes both users (cascading their `sources`/`flashcards` per the existing `ON DELETE CASCADE`).

**Contract**: Exported shape: `setupTestUsers(): Promise<{ userA: TestSession; userB: TestSession }>` and `teardownTestUsers(): Promise<void>`, where `TestSession` carries whatever `createClient()` needs (request headers + a cookie-jar-like object) plus the user's `id`. This is the one fixture every Phase 3/4 integration test imports — get its shape right here since later phases depend on it.

### Success Criteria:

#### Automated Verification:

- [ ] Vitest runs with zero test files present: `npm run test`
- [ ] Type checking passes: `npx astro check`
- [ ] Linting passes: `npm run lint`

**Note (discovered during implementation):** `isolation.sql` currently fails against the live schema — `learned_language`/`known_language` became `NOT NULL` in a later migration (`20260726105652`) that predates the file's own fixtures. This is pre-existing schema drift, unrelated to the Vitest bootstrap; fixing it is Phase 2's job. Dropped from this phase's verification scope rather than asserting a false pass.

#### Manual Verification:

- [ ] `setupTestUsers()` run once manually confirms two real users appear in the hosted project's `auth.users`, and `teardownTestUsers()` removes them cleanly

---

## Phase 2: RLS + Storage-Bucket pgTAP Suite

### Overview

Convert `isolation.sql` from a hand-rolled `DO` block into real pgTAP, preserving every existing assertion, and add the missing Storage-bucket-policy coverage (all 4 operations) for the private `screenshots` bucket.

### Changes Required:

#### 1. Convert to real pgTAP + add Storage coverage

**File**: `supabase/tests/isolation.sql`

**Intent**: Replace the `DO $$...$$` block with pgTAP's standard transactional structure so failures report per-assertion (via `diag`/`ok`) instead of aborting on the first `raise exception`, and extend the fixture set to include two `storage.objects` rows (one per test user, at the `{user_id}/...` path convention the app itself uses) so all 4 Storage policies get exercised the same way the table policies already are.

**Contract**: The file's outer shape — this is the one place a snippet earns its keep, since every future pgTAP test in this project inherits this skeleton:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(<N>);

-- fixtures (as privileged role) ...
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);

select results_eq(
  $$ select count(*)::int from public.sources where user_id = '<user_a>' $$,
  $$ values (0) $$,
  'user B cannot SELECT user A''s sources'
);
-- ... one results_eq/throws_ok/lives_ok per existing assertion, plus 4 new ones for
-- storage.objects select/insert/update/delete against the screenshots bucket ...

select * from finish();
rollback;
```

Because the whole file runs inside one `begin`/`rollback`, both the `create extension` and every fixture row are undone automatically on completion — no manual cleanup block is needed (unlike the current file's explicit `delete from auth.users` at the end). Preserve every one of the 7 existing assertions (table SELECT/INSERT/UPDATE/DELETE/cascade) as pgTAP equivalents; add 4 new ones for Storage select/insert/update/delete, keyed on the same `{user_id}/...` path convention `sources.ts:62` uses.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run test:rls` passes with all assertions (7 existing + 4 new Storage ones) reporting individually via pgTAP output
- [ ] Deliberately breaking one Storage policy locally (e.g., commenting out `screenshots_owner_select` in a scratch copy) makes the corresponding assertion fail with a specific, readable pgTAP diagnostic — confirms the conversion didn't lose granularity

#### Manual Verification:

- [ ] Run `npm run test:rls` twice in a row and confirm the hosted project shows no leftover fixture rows or users afterward (transaction rollback verified empirically, not just by reading the SQL)

---

## Phase 3: Close the Two Silent-Failure Gaps

### Overview

Fix the export-banner render-condition gap and the unguarded `formData()` parsing gap, each backed by a unit test on an extracted pure function — following the project's existing eval-cards.ts/csv-smoke.ts convention of testing pure functions directly rather than rendering a page.

### Changes Required:

#### 1. Export-banner visibility helper

**File**: `src/lib/dashboard-view.ts` (new)

**Intent**: Extract the "should the Export to Anki section render" decision out of `dashboard.astro`'s inline JSX condition into a plain exported function, so the fix (dropping the `pairReady &&` gate that was hiding `exportError`) is unit-testable without needing the Astro Container API.

**Contract**: `shouldShowExportSection(canExport: boolean, hasExportError: boolean): boolean` returns `canExport || hasExportError` — no `pairReady` input at all, which is the fix itself (the current bug is that `pairReady` gates the whole section even when there's nothing pair-dependent left to hide once an error exists).

#### 2. Wire the helper into the page

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the inline condition at line 222 (`pairReady && (canExport || exportError)`) with a call to `shouldShowExportSection(canExport, Boolean(exportError))`.

**Contract**: Same rendered markup as today in every case except the one the fix targets: `exportError` truthy and `pairReady` false now still renders the "Export to Anki" heading + red error banner (no download link, since `canExport` stays false), rather than rendering nothing.

#### 3. New generic request-parsing error code

**File**: `src/lib/source-errors.ts`

**Intent**: Add one new `SourceErrorCode` member for "the request body couldn't be read" (malformed multipart/form data), with a user-facing message telling them to retry.

**Contract**: New code, e.g. `"request-invalid"`, added to the `SourceErrorCode` union and its paired entry in `SOURCE_ERROR_MESSAGES` — the existing exhaustiveness check means forgetting the message entry is a compile error, not a runtime gap.

#### 4. Guard `formData()` on all 4 POST routes

**Files**: `src/pages/api/sources.ts`, `src/pages/api/sources/[id]/generate.ts`, `src/pages/api/sources/[id]/delete.ts`, `src/pages/api/sources/[id]/review.ts`

**Intent**: Wrap each route's `context.request.formData()` call in try/catch. On catch, redirect with the new `request-invalid` code — via `dashboardUrl({ error: "request-invalid" })` in `sources.ts` (where `fail` isn't defined until after language validation), and via the route's own `fail("request-invalid")` in the other three (where `fail` is already in scope before `formData()` is called).

**Contract**: No other branch's behavior changes; a well-formed request that happens to fail some other check still hits its existing outcome code.

#### 5. Regression tests

**Files**: `src/lib/dashboard-view.test.ts` (new), `src/pages/api/sources.test.ts`, `src/pages/api/sources/[id]/generate.test.ts`, `src/pages/api/sources/[id]/delete.test.ts`, `src/pages/api/sources/[id]/review.test.ts` (new)

**Intent**: Unit-test `shouldShowExportSection` against its 4 truth-table inputs directly (no Container API, no Supabase, no HTTP). For each of the 4 routes, call the exported `POST` function with a mock `APIContext` whose `request.formData()` throws, and assert the redirect `Location` carries `error=request-invalid` — following the official Astro guidance of testing endpoints as plain functions.

**Contract**: These are true unit tests (no network, no real Supabase project) — the mock context only needs `request`, `cookies`, and `locals.user` populated well enough for each route to reach its `formData()` call before anything else short-circuits.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run test` passes, including the new `dashboard-view.test.ts` and the 4 route-level `formData()`-throws tests
- [ ] Type checking passes: `npx astro check`
- [ ] Linting passes: `npm run lint`
- [ ] Build succeeds: `npm run build`

#### Manual Verification:

- [ ] Manually clear the `anki_source_pair` cookie, ensure the test account has zero sources, and hit `/api/export.csv?learned_language=xx&known_language=yy` directly — confirm the dashboard now shows the export-error banner instead of nothing
- [ ] Manually POST a malformed multipart body to one of the 4 routes (e.g., via curl with a broken `Content-Type` boundary) and confirm the app's error banner renders instead of Astro's default 500 page

---

## Phase 4: IDOR Integration Tests

### Overview

Prove that a second authenticated user's real session cannot reach a first user's source, flashcards, or screenshot through any of the 5 routes/pages that rely on RLS alone (no defense-in-depth check) — using Phase 1's seeded test-user fixtures.

### Changes Required:

#### 1. Route-level IDOR tests

**File**: `src/pages/api/sources/[id]/generate.test.ts` (extend from Phase 3), `src/pages/api/sources/[id]/delete.integration.test.ts` (new), `src/pages/api/sources/[id]/review.integration.test.ts` (new), `src/pages/api/sources/[id]/export.csv.integration.test.ts` (new)

**Intent**: For each route, seed a source (and, where relevant, flashcards) as user A via `setupTestUsers()`, then call the route's exported `POST`/`GET` function with user B's real session, passing user A's known resource id. Assert the response is the route's "not found" outcome (never user A's data), and assert user A's rows are unchanged afterward (a direct follow-up read as user A).

**Contract**: `review.ts`'s case is the one with a distinct assertion shape: since it intersects submitted ids against `ownIds` (empty, because RLS hides user A's cards from user B), the call still redirects success — assert specifically that user A's `discarded` flags are untouched by the call, since a false-positive "success" here would mask a real leak if the intersection logic ever changed.

#### 2. Page-level IDOR test

**File**: `src/pages/sources/[id].test.ts` (new)

**Intent**: Render `src/pages/sources/[id].astro` via the Astro Container API with user B's session and user A's known source id; assert the rendered output shows the "source not found" panel and contains none of user A's card content.

**Contract**: This is the one test in the phase that needs Astro's Container API. Per the Astro 6 regression noted in Current State Analysis, the Vitest test file/config for this specific test must use the `ssr` Vite environment, not the default `node` test environment used everywhere else in this plan — get this wrong and the test can silently pass for the wrong reason (stubbed-out component) rather than actually rendering the page.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run test` passes, including all 5 new/extended IDOR tests
- [ ] Each IDOR test fails loudly (not silently passes) when temporarily pointed at user A's own session instead of user B's — confirms the test actually exercises the cross-user path rather than trivially passing
- [ ] Type checking passes: `npx astro check`
- [ ] Linting passes: `npm run lint`

#### Manual Verification:

- [ ] Manually sign in as two real accounts in two browser sessions, and confirm user B pasting user A's `/sources/{id}` URL sees "source not found," not user A's cards

---

## Phase 5: Cookbook Update

### Overview

Fill in `test-plan.md` §6 with the patterns this phase established, and close out rollout Phase 1's status.

### Changes Required:

#### 1. Cookbook sections

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD` placeholders in §6.1 (unit test), §6.2 (integration test), §6.4 (new API endpoint test), and §6.5 (RLS/isolation test) with the concrete location, naming, reference test, and run command this phase established. Append one 2-3 line note to §6.6 capturing the Astro 6 Container API `ssr`-environment gotcha from Phase 4, since a future contributor testing any `.astro` page will hit it too.

**Contract**: §6.1 points at `src/lib/dashboard-view.test.ts` as the reference; §6.2/§6.4 point at the Phase 3/4 route test files and `npm run test`; §6.5 points at `supabase/tests/isolation.sql` and `npm run test:rls`. Do not touch §1–§5 (frozen strategy) or §7/§8 in this edit.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run test` and `npm run test:rls` both still pass after the doc-only edit (no code changed, sanity check)

#### Manual Verification:

- [ ] A fresh read of `test-plan.md` §6 answers "how do I add a test for a new API endpoint in this project" concretely, per the skill's own smoke-test criterion

---

## Testing Strategy

### Unit Tests:

- `shouldShowExportSection` truth table (4 cases)
- Each of the 4 routes' `formData()`-throws branch

### Integration Tests:

- 5 IDOR scenarios (user B requesting user A's known resource, via 4 route handlers + 1 page render)
- pgTAP: 7 existing RLS assertions + 4 new Storage-policy assertions

### Manual Testing Steps:

1. Clear pair cookie + zero sources, hit account-wide export directly, confirm banner shows
2. POST malformed multipart body to each of the 4 routes, confirm app banner (not a raw 500)
3. Two real browser sessions, cross-user URL paste, confirm "not found"
4. Run `npm run test:rls` twice, confirm hosted project has zero leftover fixture rows

## Performance Considerations

None — this phase adds tests and two small fixes, no new runtime code paths in the request-serving flow beyond a try/catch and a boolean-condition change.

## Migration Notes

None — no schema changes. The pgTAP conversion runs entirely inside a transaction that rolls back, so it never leaves a lasting change on the hosted project.

## References

- Test plan: `context/foundation/test-plan.md` §2 (Risks #1, #2), §3 (Phase 1 row)
- Change identity: `context/changes/testing-critical-path-isolation/change.md`
- Existing isolation suite (being converted): `supabase/tests/isolation.sql`
- Existing pure-function test precedent: `scripts/eval-cards.ts`, `scripts/csv-smoke.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Bootstrap Test Infrastructure

#### Automated

- [x] 1.1 Vitest runs with zero test files present
- [x] 1.2 Type checking passes
- [x] 1.3 Linting passes
- [x] 1.4 `npm run test:rls` verification — skipped; pre-existing schema drift in isolation.sql, deferred to Phase 2 (see note in Phase 1 Success Criteria)

#### Manual

- [x] 1.5 `setupTestUsers()`/`teardownTestUsers()` confirmed against hosted project

### Phase 2: RLS + Storage-Bucket pgTAP Suite

#### Automated

- [ ] 2.1 `npm run test:rls` passes with 7 existing + 4 new Storage assertions
- [ ] 2.2 Deliberately-broken policy makes the corresponding assertion fail with a specific diagnostic

#### Manual

- [ ] 2.3 Two consecutive runs leave no leftover fixture rows/users

### Phase 3: Close the Two Silent-Failure Gaps

#### Automated

- [ ] 3.1 `npm run test` passes (dashboard-view + 4 formData tests)
- [ ] 3.2 Type checking passes
- [ ] 3.3 Linting passes
- [ ] 3.4 Build succeeds

#### Manual

- [ ] 3.5 Export-banner gap manually reproduced-then-fixed
- [ ] 3.6 Malformed multipart body manually confirmed to show app banner, not raw 500

### Phase 4: IDOR Integration Tests

#### Automated

- [ ] 4.1 `npm run test` passes (5 IDOR tests)
- [ ] 4.2 Each IDOR test fails when pointed at the wrong (own) session
- [ ] 4.3 Type checking passes
- [ ] 4.4 Linting passes

#### Manual

- [ ] 4.5 Two real browser sessions, cross-user URL paste confirmed blocked

### Phase 5: Cookbook Update

#### Automated

- [ ] 5.1 `npm run test` and `npm run test:rls` still pass after doc-only edit

#### Manual

- [ ] 5.2 §6 read-through answers "how do I add a test for X" concretely
