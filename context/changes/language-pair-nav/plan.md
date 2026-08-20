# Language Pair Nav Implementation Plan

## Overview

The dashboard today mixes every language pair a user has into one "Your decks" list, grouped alphabetically. This plan splits it by pair: a top nav lists the user's pairs (most-recently-added first) plus an "add a language pair" action, clicking a pair scopes the dashboard (deck list, CSV export, kept-count) to just that pair, and a bare `/dashboard` visit defaults to the most recently added pair instead of an all-pairs mix or a blank picker.

## Current State Analysis

- A "pair" has no dedicated table — it is purely the distinct `(learned_language, known_language)` values on a user's `sources` rows (`supabase/migrations/20260726105652_add_screenshot_source_fields.sql:25-26`), no unique constraint or index on the combination.
- `src/pages/dashboard.astro:61-75` queries **all** of a user's sources (with embedded flashcards) and groups them by pair via `toDeckGroups` (`src/lib/decks.ts:96-124`), rendering one `<h3>` section per pair. This is the "mixed languages" behavior being replaced.
- The "Learning direction" pair in the URL (`?learned_language=&known_language=`) only controls the **add-source** flow (`AddSourceForm` vs `LanguagePairForm`, `dashboard.astro:113-155`) — it does not currently filter the deck list below it, which is why decks from every pair show up regardless of which pair is "active."
- `src/middleware.ts:36-54` already recalls a pair from a cookie (`PAIR_COOKIE`, `src/lib/source-pair.ts:16`) on a bare `/dashboard` visit, and clears it on `?pair=change`. When no valid pair is in the URL and no cookie is set, nothing happens today — the request falls through and the blank `LanguagePairForm` picker renders, even for a returning user with existing sources.
- Two CSV export endpoints exist, neither pair-scoped: `src/pages/api/export.csv.ts` (account-wide, all pairs tagged and mixed in one file) and `src/pages/api/sources/[id]/export.csv.ts` (single source). No per-pair export exists.
- `LanguagePairForm` (`src/components/sources/LanguagePairForm.tsx`) and the `?pair=change` link (`dashboard.astro:124-129`) are the only existing way to pick/switch a pair — a plain `GET` to `/dashboard` with new query params, no stored list of pairs to choose from.
- `/sources/[id].astro:91-102` already got a "Dashboard" link and an "Add another" link in a prior change — this plan adds pair-switching alongside them, not in place of them.

## Desired End State

- A new `PairNav` shows on `/dashboard` and `/sources/[id]`: one link per pair the user has (most-recently-added pair first), the active pair visually distinguished, plus an "Add a language pair" link.
- `/dashboard` shows the deck list, kept-count, and "Download CSV" for **one** pair at a time — whichever pair is in the URL.
- The CSV download on the dashboard contains only the active pair's kept cards; the account-wide export endpoint still exists and still works if hit directly, it's just no longer linked from the dashboard UI.
- A bare `/dashboard` visit with no valid pair in the URL and no remembered cookie redirects to the user's most-recently-added-source pair. Only a user with zero sources still sees the blank "pick a pair" screen.
- The old "Change" link on the dashboard is gone — the nav's pair pills and "Add a language pair" link supersede it.

Verify by: visiting `/dashboard` as a user with sources in 2+ pairs, seeing the nav list them newest-first, clicking between them and seeing the deck list/export scope to each; visiting bare `/dashboard` (fresh session, no cookie) and landing directly on the most recent pair; downloading CSV from the dashboard and confirming it contains only the active pair's cards.

### Key Discoveries:

- `toDeckGroups` (`src/lib/decks.ts:96-124`) already handles the "group rows by pair" logic — once the dashboard's source query is filtered to one pair, it will only ever produce zero or one group, so the per-group `<h3>` wrapper in the template becomes redundant rather than the grouping function needing to change.
- "Most recent pair" for the default-redirect needs only `order by created_at desc limit 1` on `sources` — a single row, not an aggregate. The nav's ordering (rank *every* pair by recency) is the one place that genuinely needs a per-pair `max(created_at)`, computed in JS from lightweight rows the same way `decks.ts` already computes labels/counts in JS rather than SQL.
- The existing `dashboardPairUrl(pair, carryOver)` helper (`src/lib/source-pair.ts:75-87`) already threads `error`/`success` params through a pair redirect — the new default-pair redirect should reuse it rather than building a URL by hand.

## What We're NOT Doing

- No dedicated `pairs` database table or migration — pairs stay derived from `sources`.
- No client-hydrated nav switcher — pair links are plain `<a href>`s, matching this codebase's SSR-first convention (`LanguagePairForm`, `AddSourceForm`).
- No removal of the account-wide export capability — `/api/export.csv` keeps working with no params, it's just no longer linked from the dashboard.
- No nav on any page besides `/dashboard` and `/sources/[id]`.
- No new "add pair" UI — it reuses the existing `?pair=change` → `LanguagePairForm` flow.

## Implementation Approach

Three phases, ordered so each is independently testable: (1) the shared data helper, the default-pair redirect, and the per-pair export capability — all backend, no visible nav yet; (2) the new `PairNav` component built and wired into `/dashboard`, which is where the "mixed languages" problem is actually fixed; (3) the same nav added to `/sources/[id]` for cross-page pair switching.

## Critical Implementation Details

**Ordering inside the middleware's `/dashboard` branch.** The new default-pair redirect must live *only* inside today's "no valid pair in URL, no remembered cookie" fallthrough (`src/middleware.ts`, the innermost `else` after the `remembered` check) — never inside the `pair === "change"` branch. `?pair=change` is what "Add a language pair" reuses to reach the blank picker; if the new most-recent-source lookup fired there too, clicking "Add a language pair" would immediately bounce back to the most recent pair instead of showing the picker, silently breaking the add-pair flow this plan depends on.

## Phase 1: Data helper, default-pair redirect, and per-pair export

### Overview

Backend pieces with no visible nav yet: a pure helper for ranking a user's pairs by recency, a middleware redirect that sends a bare `/dashboard` visit to the most recent pair, and a per-pair filter on the existing CSV export endpoint.

### Changes Required:

#### 1. Pair-summary helper

**File**: `src/lib/pairs.ts` (new)

**Intent**: Turn a user's lightweight source rows into a list of distinct pairs ordered most-recently-added first, for the nav and for ranking — mirrors how `decks.ts` turns source rows into decks: pure, no Supabase calls, called by whichever page already ran the query.

**Contract**: Export a `PairSourceRow` type (`learned_language`, `known_language`, `created_at` — no flashcards needed) and a `PairSummary` type (`learnedLanguage`, `knownLanguage`, `mostRecentCreatedAt`). Export `toPairSummaries(rows): PairSummary[]` that groups by `(learned_language, known_language)`, keeps the max `created_at` per group, and sorts descending by that value (tie-break stably, same pattern as `decks.ts`'s `isEarlier` tiebreaker).

#### 2. Default-pair redirect

**File**: `src/middleware.ts`

**Intent**: A returning user with existing sources who lands on bare `/dashboard` (no pair in the URL, no remembered cookie) should go straight to their most recently added pair instead of the blank picker.

**Contract**: Inside the existing `/dashboard` branch, in the sub-case where `remembered` is `null` today (nothing happens, request falls through) — query `sources` for `learned_language, known_language` ordered by `created_at desc`, limited to 1 row, for the current user. If a row comes back, `return context.redirect(dashboardPairUrl({ learnedLanguage: row.learned_language, knownLanguage: row.known_language }, params))`. If no row (zero sources), fall through unchanged to today's blank-picker rendering. See Critical Implementation Details above for the exact placement.

#### 3. Per-pair CSV export

**File**: `src/pages/api/export.csv.ts`

**Intent**: Let the existing account-wide export also scope to one pair, so the dashboard's per-pair download can reuse this endpoint instead of a new route.

**Contract**: Read optional `learned_language` / `known_language` query params from `context.url.searchParams`. When both are present and `isValidPair(...)` is true, add matching `.eq("sources.learned_language", ...)` / `.eq("sources.known_language", ...)` filters to the existing paged query, and call `exportFilename(date, { learnedLanguage, knownLanguage })` instead of the no-arg form. When absent (or not a valid pair), behavior is unchanged — account-wide, `exportFilename(date)`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build (includes Astro type checking) passes: `npm run build`

#### Manual Verification:

- As a user with sources in 2+ pairs: clear cookies (or use a fresh browser profile), sign in, visit `/dashboard` directly — land on the most-recently-added pair, not the blank picker.
- As a brand-new user with zero sources: bare `/dashboard` still shows the blank "pick a pair" screen.
- Hit `/api/export.csv?learned_language=<x>&known_language=<y>` directly for a pair with kept cards — downloaded file contains only that pair's cards. Hit `/api/export.csv` with no params — still exports everything, unchanged.
- From the dashboard, use `?pair=change` (or click "Change" — still present until phase 2) and confirm it still lands on the blank picker, not back on the most recent pair.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: PairNav component and dashboard integration

### Overview

Build the shared nav and wire it into `/dashboard`: scope the deck list, kept-count, and CSV link to the active pair, and retire the old "Change" link in favor of the nav.

### Changes Required:

#### 1. PairNav component

**File**: `src/components/PairNav.astro` (new)

**Intent**: A shared, presentational top-of-page bar listing the user's pairs (newest first) as plain links, with the active pair visually distinguished, plus an "Add a language pair" link — reused by both `/dashboard` and `/sources/[id]` (phase 3).

**Contract**: Props: `pairs: PairSummary[]`, `activeLearnedLanguage?: string`, `activeKnownLanguage?: string`. One `<a>` per pair via `dashboardUrl({ learned_language, known_language })`, styled distinctly when it matches the active props. One trailing `<a>` "Add a language pair" via `dashboardUrl({ pair: "change" })`. Renders even with zero pairs (just the "Add a language pair" link) — no separate empty-state branch needed. Fetches nothing itself; the calling page supplies `pairs`.

#### 2. Dashboard scoped to one pair

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the all-pairs mixed view with a single-pair view, and add the nav above it.

**Contract**:
- Add a lightweight `sources` query (`id, learned_language, known_language, created_at`, no flashcards) for the current user, pass its rows through `toPairSummaries` into `<PairNav pairs={...} activeLearnedLanguage={learnedLanguage} activeKnownLanguage={knownLanguage} />`.
- Filter the existing deck-list query (`dashboard.astro:61-70`) with `.eq("learned_language", learnedLanguage).eq("known_language", knownLanguage)` when `pairReady`; render `toDeckGroups(sourceRows ?? [])[0]?.decks ?? []` as a flat list (drop the per-group `<h3>` pair-label loop — the nav and the "Learning direction" header already say which pair is active).
- Replace the account-wide kept-count query (`dashboard.astro:46-51`) with the same query filtered by the active pair (same `countFailed || keptCount > 0` gating as today), and point "Download CSV" at `/api/export.csv?learned_language=...&known_language=...`.
- Remove the "Change" link (`dashboard.astro:124-129`) — superseded by the nav's pair pills and "Add a language pair" link.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build (includes Astro type checking) passes: `npm run build`

#### Manual Verification:

- Visit `/dashboard` for a pair with sources in other pairs too — "Your decks" shows only the active pair's decks.
- The nav lists all of the user's pairs, most-recently-added first; clicking a different pair switches the whole dashboard (decks, count, CSV link) to it.
- "Download CSV" downloads only the active pair's kept cards; the shown count matches.
- "Add a language pair" reaches the blank pick-a-pair screen; the old "Change" link is gone.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: PairNav on the source detail page

### Overview

Add the same nav to `/sources/[id]` so a user can jump straight to a different pair's dashboard from inside a source's detail view.

### Changes Required:

#### 1. Source detail page gets the nav

**File**: `src/pages/sources/[id].astro`

**Intent**: Let a user switch pairs from a source's detail view without going back to the dashboard first.

**Contract**: Run the same lightweight `sources` query as `dashboard.astro` (id, learned_language, known_language, created_at) for the current user, pass through `toPairSummaries` into `<PairNav>`, with `source.learned_language` / `source.known_language` as the active pair. Render it near the existing header, alongside the "Dashboard" / "Add another" links added in a prior change.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build (includes Astro type checking) passes: `npm run build`

#### Manual Verification:

- Open a source's detail page — the nav is visible, and the current source's pair is highlighted as active.
- Click a different pair from the nav — land on that pair's dashboard, decks/count/CSV scoped correctly.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Manual Testing Steps:

1. As a user with sources in 3 pairs (e.g. en→pl, it→en, es→pl): visit `/dashboard`, confirm the nav lists all three, most-recently-added first.
2. Click each pair in turn; confirm the deck list, kept-count, and CSV link scope correctly each time.
3. Clear cookies, sign in again, visit bare `/dashboard`; confirm it lands directly on the most-recently-added pair.
4. Click "Add a language pair", pick a brand-new pair, confirm it doesn't yet appear in the nav until a source is added to it (expected — pairs are derived from sources).
5. From a source detail page, use the nav to jump to a different pair; confirm it lands on that pair's dashboard.
6. Confirm a brand-new user (zero sources) still sees the blank pick-a-pair screen with just an "Add a language pair" link in the nav.

## References

- Related bug report: user feedback on dashboard "Your decks" mixing every language pair together.
- Existing pattern followed: `src/lib/decks.ts` (pure grouping/labeling logic consumed by a page's own query), `src/components/Topbar.astro` (presentational nav component fed props by its caller).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data helper, default-pair redirect, and per-pair export

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 936f521
- [x] 1.2 Build (includes Astro type checking) passes: `npm run build` — 936f521

#### Manual

- [x] 1.3 Fresh session, existing user with 2+ pairs: bare `/dashboard` lands on the most-recently-added pair — 936f521
- [x] 1.4 Brand-new user (zero sources): bare `/dashboard` still shows the blank pick-a-pair screen — 936f521
- [x] 1.5 `/api/export.csv?learned_language=<x>&known_language=<y>` downloads only that pair's kept cards; no-params call still exports everything — 936f521
- [x] 1.6 `?pair=change` still lands on the blank picker, not back on the most recent pair — 936f521

### Phase 2: PairNav component and dashboard integration

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 7112254
- [x] 2.2 Build (includes Astro type checking) passes: `npm run build` — 7112254

#### Manual

- [x] 2.3 `/dashboard` "Your decks" shows only the active pair's decks — 7112254
- [x] 2.4 Nav lists all pairs newest-first; clicking one switches decks/count/CSV link to it — 7112254
- [x] 2.5 "Download CSV" downloads only the active pair's kept cards, count matches — 7112254
- [x] 2.6 "Add a language pair" reaches the blank picker; old "Change" link is gone — 7112254

### Phase 3: PairNav on the source detail page

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — 1b8becd
- [x] 3.2 Build (includes Astro type checking) passes: `npm run build` — 1b8becd

#### Manual

- [x] 3.3 Source detail page shows the nav with the current pair highlighted — 1b8becd
- [x] 3.4 Clicking a different pair from the nav lands on that pair's dashboard, correctly scoped — 1b8becd
