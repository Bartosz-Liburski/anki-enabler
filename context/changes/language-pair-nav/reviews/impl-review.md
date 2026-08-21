<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Split dashboard by language pair with a top nav switcher

- **Plan**: context/changes/language-pair-nav/plan.md
- **Scope**: Full plan (Phases 1-3, all complete)
- **Date**: 2026-08-21
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Default-pair redirect skips pair validation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:57-72
- **Detail**: The new most-recent-pair redirect builds its target straight from the `sources` row (`mostRecent.learned_language`/`known_language`) with no `isValidPair` check, unlike every other path that feeds a pair into a redirect: the cookie path validates via `readPairCookie`, and the URL-param path is checked before this branch. If a `sources` row ever held a pair value outside the current `LANGUAGES` allowlist (e.g. a language later removed/renamed), the redirect would land on an invalid pair, `isValidPair` would fail again next request, the cookie would still be empty, and the same row would produce the same redirect — an infinite redirect loop for that user. Currently unreachable in practice (`api/sources.ts` validates on insert), but it's a latent, one-changed-constant-away landmine.
- **Fix**: Guard the redirect with `isValidPair(mostRecent.learned_language, mostRecent.known_language)`, falling through to `next()` on failure — mirrors the validation the cookie path already does in this same file.
- **Decision**: FIXED — added `isValidPair` guard to the `mostRecent` check (src/middleware.ts).

### F2 — Pairs query error silently discarded

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:44-47, src/pages/sources/[id].astro:32-35
- **Detail**: The new lightweight `sources` query for `PairNav` discards its `error` entirely (`const { data: pairRows } = ...`). In `dashboard.astro` this is inconsistent with the file's own two other queries touched in this diff — `countError` and `decksError` are both explicitly checked and rendered as a failure banner. A transient failure on the pairs query instead silently degrades to an empty/incomplete nav with no signal to the user, breaking the "no silent failure" convention the same file otherwise enforces twice.
- **Fix A ⭐ Recommended**: Check the error explicitly, matching `countError`/`decksError` in the same file, and surface it through the existing failure-banner mechanism.
  - Strength: Matches an established precedent two queries away in the same file; catches a real failure mode (transient network blip silently hides the nav with no explanation).
  - Tradeoff: Slightly more code in an otherwise terse fetch; needs a place to surface a third error source alongside the existing banner.
  - Confidence: MED — plausible this was just overlooked, but nav failing open (fewer pairs shown) is arguably acceptable for a secondary UI element, so it isn't obviously wrong either.
  - Blind spot: Haven't verified how easy it is to merge a third error source into the existing banner without restructuring it.
- **Fix B**: Leave as-is; add a one-line comment stating the pairs query intentionally fails open since the nav is secondary, not primary content.
  - Strength: No code change; matches a "nav is a nice-to-have" judgment call.
  - Tradeoff: A future reader still can't tell decision from oversight without the comment actually being written.
  - Confidence: MED — plausible intentional design given nav severity is low, but nothing in the plan states this explicitly.
  - Blind spot: Whether this silent-swallow pattern already exists elsewhere in the codebase for similarly "secondary" queries, which would strengthen the case that it's a convention rather than a gap.
- **Decision**: FIXED via Fix A — captured `pairsError`/`pairsFailed` and added a matching red banner (same style as `decksFailed`) in dashboard.astro and sources/[id].astro.

### F3 — Pairs query omits `id` column contracted by the plan

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/dashboard.astro:44-47, src/pages/sources/[id].astro:32-35, src/lib/pairs.ts:4-6
- **Detail**: The plan's contract for both pages says to select `id, learned_language, known_language, created_at`; both pages select only `learned_language, known_language, created_at`. Functionally harmless — `PairSourceRow`/`toPairSummaries` never use `id` — but `pairs.ts`'s own docstring also says the query should include `id`, so the doc comment and the actual callers now disagree with each other.
- **Fix**: Drop the stale `id` mention from `pairs.ts`'s docstring to match what the pages actually select (simpler than adding an unused column to two queries).
- **Decision**: FIXED — dropped `id` from the docstring in src/lib/pairs.ts.
