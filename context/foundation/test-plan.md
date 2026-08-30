# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-21 (Phase 1 change opened)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in area Y"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`, `scripts/` (excludes `node_modules`, `dist`, `.astro`, build output). 25 commits/30d — sufficient signal.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|--------------------------|--------|------------|----------------------------------|
| 1 | A generation or review failure (zero usable cards, mid-call error) shows a blank/silent result instead of an explanatory message | High | Medium | PRD FR-007 acceptance criterion ("a source that yields no usable flashcards shows an explanatory state, not a silent empty result"); interview Q1 (top user worry: silent failure); hot-spot dir `src/pages/api` (12 commits/30d), `src/lib/llm` (3 commits/30d) |
| 2 | A route or Storage path lets one authenticated user read, modify, or delete another user's source, flashcards, or screenshot (IDOR) | High | Medium | PRD NFR ("a user's sources and generated flashcards are never visible to any other user"); archive `per-user-data-isolation/plan.md` pre-mortem (module-scope client session leak was the #1 named risk); hot-spot dir `src/pages/api` (12), `src/middleware.ts` (6) |
| 3 | CSV export silently corrupts or drops card content (unescaped comma, quote, angle bracket, newline) so the imported deck is wrong or incomplete | High | Medium | PRD FR-012 + Open Question 1 (CSV column layout); archive `export-kept-cards-csv/plan.md` (explicit escaping/verification note on comma and angle-bracket survival); hot-spot dir `src/pages/api` (export routes, 3+2 commits) |
| 4 | Generated flashcards are silently reversed or mismatched against the source's learned/known language pair | High | Medium | PRD US-01 acceptance criterion (translation direction must match source's learning context); roadmap.md "riskiest assumption" framing (north star, ≥75%-kept bar); hot-spot dir `src/lib/llm` (3) |
| 5 | Deleting a source removes its flashcards but leaves the screenshot orphaned in Storage — deletion is incomplete | Medium | Medium-High | archive `manage-sources-and-decks/plan.md` (explicitly names this gap: "every deleted source permanently consumes up to 5 MB... the deletion is not really a deletion"); interview Q3 (source/deck management named as the lowest-confidence area); hot-spot dir `src/components/sources` (5), `src/pages/dashboard.astro` (8) |
| 6 | A source's size/length cap or per-source card-count cap is bypassed, letting generation run at unbounded cost | High | Low | PRD NFR + Guardrails section (explicit cost-bound requirement); tech-stack.md edge-runtime constraint on long-running generation |

**Impact × Likelihood rubric:**

| Rating | Impact | Likelihood |
|--------|--------|------------|
| High   | user loses access, data, or money; failure is publicly visible | area changes weekly, or we have already been burned here |
| Medium | feature degrades, a workaround exists, only some users affected | touched occasionally, has been a source of bugs |
| Low    | cosmetic, easily reverted, no data effect | stable code, rarely touched |

**Abuse / security lens applied:** the product has auth and per-user data; Risk #2 is the mandatory IDOR/authorization scenario — a route or Storage path check gap, not just an authentication gap. No injection/secret-leakage/resource-abuse row scored High enough to make the top 6 given the small-scale, low-QPS, solo-user target (`prd.md` frontmatter); revisit if the user base or input surface grows.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-------------------------------|----------------|----------------------------------------|--------------------------|---------------------------|
| #1 | Every failure branch (zero cards, generation error, missing config) renders a visible explanatory message — never a blank result | "The outcome-code redirect already covers this" — a branch can set a code with no rendered message behind it | Which failure branches exist end to end; whether every outcome code maps to actual rendered text | integration (page/component render assertion per known failure code) | Asserting a redirect happened without asserting the message text renders |
| #2 | A second authenticated user's session cannot read, write, or delete a first user's source, flashcard, or screenshot via any route or Storage path | "RLS alone covers it" — one helper using the service_role key silently bypasses RLS; Storage needs its own owner-path enforcement independent of table RLS | Which Supabase client (anon vs service_role) each handler actually uses; whether the Storage bucket policy enforces owner-path independent of the API route | extend the existing `supabase/tests/isolation.sql` pgTAP pattern to current schema + a per-route integration test | Testing only "unauthenticated request → 401", never "different authenticated user → 403/404" (the actual IDOR case) |
| #3 | Exported CSV preserves comma, quote, angle-bracket, newline, and unicode content exactly; every kept card reimports intact | "Escaping front/back fields is enough" — a tag or pair-derived field could also carry a delimiter-like character | The exact CSV column layout implemented; whether escaping is hand-rolled or library-based | unit test on the CSV-generation function against an adversarial input table | A happy-path-only test using plain ASCII strings, which passes even with broken escaping |
| #4 | Generated card front/back orientation matches the source's stored learned/known language pair, never inverted | "A correctly-instructed prompt implies correct output direction" — a model can still invert direction despite correct instructions | How the language pair threads into the model call; whether output orientation is validated/corrected in code, not just requested via prompt | unit test on the orientation-validation function with a fixed pair + fixture model response; AI-native extension of the existing `scripts/eval-cards.ts` to assert per-card direction, not just aggregate keep-rate | An eval that only checks the aggregate ≥75%-kept metric, which can hold even if direction is systematically wrong for one language pair |
| #5 | Deleting a source removes both its DB rows and its Storage object — nothing survives under that user/source path | "The `flashcards` FK cascade proves deletion is complete" — cascade only covers DB rows, not the Storage object, which needs its own explicit delete call | The delete handler's actual call sequence (DB delete vs Storage delete); whether a Storage-delete failure is swallowed or surfaced | integration test against a test Supabase project/bucket asserting both the DB rows and the Storage object are gone after delete | Asserting only "flashcard count is 0" (DB-only) and calling the deletion verified |
| #6 | A source exceeding the published size/length limit is rejected before any LLM call runs; generated card count never exceeds the ceiling regardless of source content | "The cap is enforced client-side" — a direct API call bypasses a UI-only check; the boundary must hold server-side | Where the size check runs relative to the LLM call; whether the card-count ceiling is enforced by truncating output or is prompt-only (not a guarantee) | integration test hitting the API endpoint directly with an oversized payload, asserting rejection before any LLM call fires | Testing the cap only through the UI form, missing a server-side enforcement gap entirely |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-------------------|----------------|------------|--------|-----------------|
| 1 | Critical-path: isolation & silent-failure | Bootstrap Vitest; extend the RLS/isolation pgTAP suite to the current schema/routes; prove every generation/review failure path renders a visible message, never a blank result | #2, #1 | pgTAP (RLS) + integration | change opened | context/changes/testing-critical-path-isolation/ |
| 2 | Data integrity: export & deletion | Unit-test CSV escaping against adversarial input; integration-test that deleting a source removes both its DB rows and its Storage object | #3, #5 | unit + integration | not started | — |
| 3 | Guardrails & generation-direction correctness | Prove size/card-count caps hold server-side (not just client-side); unit-test translation-direction validation; extend the existing eval harness to check per-card direction, not just aggregate keep-rate | #6, #4 | unit + integration + AI-native (eval extension) | not started | — |
| 4 | Quality-gates wiring | Wire lint+typecheck+unit/integration (and the pgTAP suite) into CI as required gates | cross-cutting | gates | not started | — |

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Recommendations in this section are grounded in local manifests/configs
plus the MCP/tools actually exposed in the current session.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | Vitest — checked: 2026-08-21 | none yet — see Phase 1 | Current-recommended for Astro 6: API routes (`src/pages/api/*.ts`) test directly as plain async functions returning a `Response`, no server needed; React islands test via `@testing-library/react`. Watch-item: testing `.astro` component rendering via the Container API requires the Vitest `ssr` environment, not `jsdom`/client — a recent Astro 6 regression (withastro/astro#14895) made this stricter. |
| DB / RLS | pgTAP via `supabase test db` — checked: 2026-08-21 | Supabase CLI (already a devDependency) | Same pattern the project already uses in `supabase/tests/isolation.sql`; official Supabase guidance still routes RLS testing through pgTAP `.sql` files under `supabase/tests/`, run via the CLI — no framework change needed, only more test files. |
| API mocking | none yet — see Phase 1 | — | Astro endpoints are plain functions; the LLM/Storage calls inside them are the mockable boundary. |
| e2e | none — not planned this rollout | — | Cost × signal: the risk map's top scenarios (silent failure, IDOR, CSV corruption, deletion, direction, guardrails) are all catchable at unit/integration/pgTAP layers; e2e would cost more per risk covered at this project's scale (solo user, low QPS per `prd.md` frontmatter) without adding signal. Revisit if a risk emerges that only manifests through full browser rendering. |
| AI-native (eval) | `scripts/eval-cards.ts` (existing, extend) — checked: 2026-08-21 | n/a | When to use: judging generation quality/direction where no deterministic oracle exists. When NOT to use: CSV escaping, RLS, Storage cleanup, cap enforcement — all deterministic, cheaper and more reliable as classic tests. |
| accessibility | none — out of scope this rollout | — | Not raised by PRD, interview, or hot-spot signal; §7 negative space covers UI polish generally. |

**Stack grounding tools (current session):**
- Docs: none available in current session (no Context7/framework-docs MCP) — relied on local manifest/config evidence (`package.json`, `astro.config.mjs`, `tech-stack.md`).
- Search: Exa.ai — checked Astro 6 + Vitest testing guidance and Supabase pgTAP/RLS testing guidance against official docs (docs.astro.build, supabase.com/docs) and a recent Astro GitHub issue; checked: 2026-08-21.
- Runtime/browser: none available in current session (no Playwright/browser MCP) — not used.
- Provider/platform: none available as a session MCP (Supabase CLI is a project devDependency, not a session tool) — not used.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck | local + CI | required (already wired — `npx astro sync && npx astro check && npm run lint`) | syntactic / type drift |
| RLS / isolation (pgTAP) | local + CI | required after §3 Phase 1 | cross-user data access regressions |
| unit + integration | local + CI | required after §3 Phase 1 | logic regressions (silent failure, CSV corruption, deletion, direction, caps) |
| e2e on critical flows | — | not planned this rollout | see §4 e2e row — cost × signal did not justify it at current scale |
| post-edit hook | local (agent loop) | out of scope — Lesson 3 configures hooks | regressions at edit time |
| visual diff (deterministic) | — | optional, not scheduled | rendering regressions |
| multimodal visual review | — | optional, not scheduled | visual issues classic diff misses (§7 excludes UI polish by user request) |
| pre-prod smoke | between merge + prod | optional, not scheduled | environment-specific failures |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

- **Location**: colocated next to the unit under test (e.g. `src/lib/dashboard-view.test.ts` next to `src/lib/dashboard-view.ts`).
- **Naming**: `<module>.test.ts`. No network, no real Supabase project — mock `@/lib/supabase`'s `createClient` (and `astro:env/server` if the module reads an env var directly) when testing a route handler in isolation.
- **Reference test**: `src/lib/dashboard-view.test.ts` (pure-function truth table) and `src/pages/api/sources.test.ts` (route handler with `createClient` mocked, testing one failure branch in isolation).
- **Run locally**: `npm run test` (or `npm run test:watch`).

### 6.2 Adding an integration test

- **Location**: colocated, named `<module>.integration.test.ts` — the distinct suffix flags "this test hits the real hosted Supabase project" at a glance; both suffixes are picked up by the same `npm run test`.
- **Setup pattern**: `beforeAll`/`afterAll` call `setupTestUsers()`/`teardownTestUsers()` from `src/test/supabase-test-users.ts` to seed two real, signed-in users against the hosted-linked project, then build a real per-request client via `createClient(user.request.headers, user.cookies)` — exactly how a live request authenticates. Requires `SUPABASE_SERVICE_ROLE_KEY` set locally (test-only; see `.env.example` — never read by app code).
- **Reference test**: `src/pages/api/sources/[id]/generate.integration.test.ts`.
- **Run locally**: `npm run test`.

### 6.3 Adding an e2e test

- Not planned this rollout — see §4 e2e row for the cost × signal reasoning. Revisit via `--refresh` if a risk surfaces that only manifests through full browser rendering.

### 6.4 Adding a test for a new API endpoint

- **Test type**: integration (preferred). Call the exported `POST`/`GET` function directly with a constructed context object (`{ request, cookies, locals, redirect, params }`) — no server needed (confirmed: Astro endpoints are plain functions returning a `Response`).
- **IDOR pattern**: seed a resource as user A, call the route with user B's real session and user A's known id, assert the route's "not found" outcome and that user A's row is unchanged. Always flip the test to user A's own session first and confirm it *fails* — that's the falsifiability check that proves the test exercises the real cross-user path rather than trivially passing.
- **Reference test**: `src/pages/api/sources/[id]/delete.integration.test.ts`.
- **When to add e2e instead**: only if the endpoint's failure mode requires the full deployed shape (auth cookie + adapter crossing) — not needed so far.
- **Page-level equivalent (Container API)**: for a `.astro` page rather than an API route, render via `astro/container`'s `experimental_AstroContainer`, registering only the renderers the tested branch actually needs (`container.addServerRenderer({ renderer: <framework>ServerRenderer })` from `<integration>/server.js` — the documented `<integration>/container-renderer` subpath does not exist in this project's installed `@astrojs/react` version). The default `node` Vitest environment is sufficient; no special environment override is needed unless a suite uses `jsdom`/`happy-dom` (this project doesn't). Reference: `src/pages/sources/[id].test.ts`.

### 6.5 Adding an RLS / isolation test

- **Location**: `supabase/tests/isolation.sql` (single file, real pgTAP — `begin`/`plan`/…/`finish`/`rollback`).
- **Output-capture pattern**: `supabase db query --file` only returns the FINAL statement's result set, so every assertion's return value is captured into a temp table first (`insert into tap_out (line) select results_eq(...)`) and selected back, in order, as the file's last statement — otherwise individual pass/fail lines are invisible.
- **`throws_ok` gotcha**: the 3-arg form `throws_ok(sql, errcode, description)` does NOT skip error-message matching — arg 3 is still `errmsg` when arg 2 is a 5-byte code. Use the 4-arg form `throws_ok(sql, errcode, NULL, description)` to match only the SQLSTATE.
- **Storage DELETE gotcha**: `storage.objects` has a `protect_delete()` trigger blocking ALL direct SQL `DELETE`, for every role — a Storage delete policy can only be proven through the real Storage API (§6.2's integration pattern), not pgTAP.
- **Reference**: `supabase/tests/isolation.sql` itself (RLS + Storage select/insert/update coverage).
- **Run locally**: `npm run test:rls` (wraps `supabase db query --file supabase/tests/isolation.sql --linked` against the hosted project).

### 6.6 Per-rollout-phase notes

- **Phase 1** found `isolation.sql` (F-01's original artifact) already failing against the current schema — `learned_language`/`known_language` became `NOT NULL` in a later migration the file's fixtures predated, and with no CI step running it, nobody had noticed. Lesson: an untested test is not a test.
- **Phase 2** found the hosted-linked execution path (chosen over local Docker) surfaces real platform gotchas invisible from reading the SQL alone — see §6.5's two gotchas above.
- **Phase 4** found the project's `@astrojs/react` version doesn't ship the `container-renderer` subpath the official Container API docs example uses, and that the Astro 6 Vitest-environment regression only bites `jsdom`/`happy-dom` setups — this project's plain `node` environment was never at risk. See §6.4's page-level note.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **UI polish/styling** — Tailwind/shadcn visual details and animations. Re-evaluate if the product adds a marketing/public-facing surface where visual regressions would be customer-visible. (Source: Phase 2 interview Q5.)
- **e2e / full-browser flows** — not a hard exclusion, but deliberately not scheduled this rollout; the risk map's top scenarios are all covered more cheaply at unit/integration/pgTAP layers. Re-evaluate if a risk emerges that only manifests through real browser rendering (e.g. island hydration bugs). (Source: §1 cost × signal.)
- **Own spaced-repetition / scheduling logic, complex media import, `.apkg` export, social features, source/flashcard editing, native/offline/localization** — all explicit PRD non-goals; no code exists to test. (Source: `prd.md` §Non-Goals.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-21
- Stack versions last verified: 2026-08-21
- AI-native tool references last verified: 2026-08-21

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive (e.g. if S-05 plain-text sources ships, it introduces a new input path not covered above),
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
