# Language Pair Nav — Plan Brief

> Full plan: `context/changes/language-pair-nav/plan.md`

## What & Why

The dashboard mixes every language pair a user has into one alphabetically-grouped "Your decks" list. This plan splits it by pair: a top nav across the user's pairs (newest first) plus "add a language pair," each pair scopes the dashboard's decks/export to itself, and a bare dashboard visit defaults to the most recently added pair instead of a mixed list or a blank picker.

## Starting Point

A "pair" isn't a stored entity — it's just distinct `(learned_language, known_language)` values on `sources` rows. The dashboard already groups by pair via `toDeckGroups`, but renders every group at once; the pair in the URL only controls the add-source form, not what's displayed below it. No per-pair export exists — only account-wide and per-source. The middleware already recalls a pair from a cookie on bare `/dashboard`, but does nothing (blank picker) when there's no cookie, even for users with existing sources.

## Desired End State

A `PairNav` on `/dashboard` and `/sources/[id]` lists the user's pairs newest-first plus "Add a language pair." The dashboard shows one pair's decks/count/CSV at a time. Bare `/dashboard` (no cookie) redirects to the most-recently-added pair; only a zero-source user still sees the blank picker.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Nav scope | Both `/dashboard` and `/sources/[id]` | User wants to switch pairs from a source's detail view too, not just the dashboard. |
| Default pair | Data-derived (`MAX(created_at)`, most recent source) | "Newest language" should mean the last screenshot added, not just whatever was last browsed via cookie. |
| Account-wide export | Kept in code, dropped from dashboard UI | Per-pair export replaces it as the primary path; the account-wide route still works if hit directly. |
| Add-pair action | Reuses existing `?pair=change` → `LanguagePairForm` flow | Zero new UI component; the flow already does exactly this. |
| Nav mechanism | Plain SSR links | Matches this codebase's no-JS-required convention (`LanguagePairForm`, `AddSourceForm`). |
| Empty/single-pair state | Nav always renders | No special-cased branch for 0-1 pairs; "Add a language pair" always has one place to live. |
| Nav ordering | Most-recently-added pair first | Same recency value the default-pair redirect already computes; matches how the feature is actually used. |
| Scope for this change | All four pieces together (nav, add-pair, per-pair export, default-pair) | Shipping only some leaves the reported "hard to read, mixed languages" problem unresolved. |

## Scope

**In scope:**
- `src/lib/pairs.ts` — pure pair-ranking helper
- Middleware default-pair redirect
- Per-pair CSV export (extends the existing account-wide endpoint)
- `PairNav.astro` component
- Dashboard scoped to one pair (decks, count, CSV, nav; old "Change" link removed)
- Nav added to `/sources/[id]`

**Out of scope:**
- A dedicated `pairs` database table/migration
- A client-hydrated switcher
- Removing the account-wide export endpoint's capability
- Nav on any page besides `/dashboard` and `/sources/[id]`

## Architecture / Approach

Three phases: backend pieces first (pair-ranking helper, redirect, export filter — no visible nav), then the nav component wired into the dashboard (where the reported problem actually gets fixed), then the same nav added to the source detail page. Follows the existing `decks.ts` convention: pure grouping/ranking logic in `src/lib`, each page runs its own query and passes rows through it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data helper, default-pair redirect, per-pair export | Backend only, no nav yet | Redirect logic must not fire inside the `?pair=change` branch, or "add a pair" breaks (see plan's Critical Implementation Details) |
| 2. PairNav + dashboard integration | The actual fix — dashboard scoped to one pair, nav visible | Deck-list template change (dropping per-group `<h3>`) touches rendering the review found brittle before |
| 3. PairNav on source detail page | Pair switching from `/sources/[id]` | Low — additive, reuses phase 2's component as-is |

**Prerequisites:** None — builds entirely on existing tables and helpers, no migration.
**Estimated effort:** Three small-to-medium phases, one manual gate each.

## Open Risks & Assumptions

- A brand-new pair (chosen via "Add a language pair" but with no source uploaded yet) won't appear in the nav until its first screenshot is added — expected, since pairs are derived from sources, not stored standalone.
- "Most recently added" pair is based on source `created_at`, not on which pair the user most recently *viewed* — matches the user's own framing ("najnowszy język") but is a deliberate divergence from the old cookie-based recall.

## Success Criteria (Summary)

- A user with multiple pairs sees them listed separately in the nav, newest first, and each pair's decks/export are shown in isolation.
- Bare `/dashboard` after clearing cookies lands directly on the most recent pair, not a blank picker or a mixed list.
- CSV downloaded from the dashboard contains only the active pair's cards.
