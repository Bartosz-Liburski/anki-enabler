# Browse and Manage Sources/Decks Implementation Plan

## Overview

Roadmap slice S-04 turns the dashboard into the app's deck view and makes a source deletable.

Every saved source becomes a deck row — grouped by learning direction, labelled by its first card,
carrying a kept-of-total count — and each source gains a delete action that takes its flashcards and
its stored screenshot with it. FR-005 (browse via the deck view), FR-006 (delete cascades), and
FR-011 (grouping, nice-to-have) all land here.

No LLM call, no new dependency, and no migration: every column this needs already exists.

## Current State Analysis

**The app has no list of anything.** `dashboard.astro` renders a language-pair picker, an upload
form, and — since S-03 — an account-wide export block. `/sources/{id}` is reachable only by the
post-upload redirect at `sources.ts:90` or by a bookmark. That gap is why S-03 shipped an
account-wide export at all: a per-source download alone would have stranded a user with several
sources. `/sources` is inside the middleware's `PROTECTED_ROUTES` (`src/middleware.ts:7`) but has no
index page, so it 404s today.

**The data is all there.** `sources` carries `learned_language`, `known_language`, `type`,
`image_path`, `created_at`, and the S-02 generation-state columns. `flashcards` carries `front`,
`back`, `discarded`, and `created_at`, with a `source_id` FK declared `ON DELETE CASCADE`
(`20260723162258_init_sources_flashcards.sql:49`) — FR-006's cascade is already guaranteed by the
schema and needs no application code. Both tables are under per-user RLS from F-01.

**What the schema does NOT cover is Storage.** Nothing links `storage.objects` to `sources`, so
deleting a source row leaves its screenshot at `{user_id}/{source_id}.{ext}` in the private
`screenshots` bucket forever. Without explicit cleanup, every deleted source permanently consumes
up to 5 MB of the user's quota and the deletion is not really a deletion.

**Destructive actions already have a shape here.** Regeneration arms on the first click and submits
a hidden `confirm=replace` field on the second (`RegenerateForm.tsx:40`), and the endpoint refuses
to proceed without that field (`generate.ts:79`) — so the protection survives a page that never
hydrates. Delete follows the same shape rather than inventing one.

**Sources have no name.** A row is a UUID, a pair, a type, a timestamp, an image path, and
generation state. Nothing in the schema can label a deck in a list.

**Verification surface.** No test framework. CI runs `npx astro sync`, `npm run lint`, `npm run
build` (`.github/workflows/ci.yml`), and `.husky/pre-commit` additionally runs `npm run csv:smoke`
since S-03.

## Desired End State

A signed-in user opens the dashboard and sees their decks below the upload form, grouped under a
heading per learning direction, newest first inside each group. Each deck reads as its first card's
front text with the pair and a "3 of 5 kept" count beneath, and clicking it opens that source's
review screen. A user with no sources yet gets a short panel explaining what will collect there.

On a source's own page, below its cards, a delete control warns what it will destroy, arms on the
first click, and on the second removes the source, its flashcards, and its stored screenshot,
landing the user back on the dashboard with a confirmation — the deck gone from the list.

**How to verify:** add two screenshots under different language pairs, generate and review both,
and confirm the dashboard shows two groups with correct labels and counts. Delete one; confirm it
disappears from the list, its cards are gone, and its object is no longer in the `screenshots`
bucket.

### Key Discoveries:

- **FR-006's cascade is schema-level, not application-level.** `source_id ... ON DELETE CASCADE` at
  `20260723162258_init_sources_flashcards.sql:49` means the delete endpoint deletes one row and the
  cards follow. Deleting cards explicitly first would be redundant and slower.
- **FR-005 forbids the obvious placement.** "browse their saved sources through the deck view (no
  separate source-browser screen)" — `prd.md` FR-005, repeated in `roadmap.md:130`. The list lives
  on the dashboard; `/sources` stays index-less.
- **Storage is the one thing the cascade misses**, and the create path already establishes the
  remedy: `sources.ts:82` removes a just-uploaded object on a failed insert, best-effort, without
  blocking the user's outcome.
- **The confirm pattern is server-enforced, not client-enforced** (`generate.ts:79`) — that is the
  property to copy, not the two-click UI.
- **`sourceUrl` / `dashboardUrl` are the only places URLs are spelled** (`source-pair.ts:60-67`),
  and `dashboardPairUrl` carries `error` / `success` across the middleware's pair-recall redirect
  (`source-pair.ts:81-84`), so a bare `dashboardUrl({ success })` survives it.
- **The review screen already loads every card of a source** (`sources/[id].astro:31`), so the
  delete control's card count costs nothing.

## What We're NOT Doing

- **No migration.** No `title` column, no `decks` table, no soft-delete flag, no `deleted_at`.
- **No `/sources` index page** — FR-005 rules it out, and the route stays 404 despite being guarded.
- **No source editing** — PRD §Non-Goals; sources remain add/delete only.
- **No delete from the deck list.** Deletion happens where the cards are visible; a row-level delete
  would confirm the destruction of cards the user cannot currently see.
- **No bulk delete, no undo, no trash.** One source at a time, irreversibly.
- **No screenshot thumbnails in the list.** The bucket is private, so every row would need its own
  signed URL — the only considered option that adds real per-render cost.
- **No pagination or search over decks.** See Performance Considerations for the accepted bound.
- **No test framework.**

## Implementation Approach

Two phases, split along the line that matters: Phase 1 only reads, Phase 2 destroys.

Phase 1 makes the dashboard the deck view. One embedded select pulls each source together with its
cards, so the label, the kept count, and the total all come from a single round trip; grouping by
pair happens in memory afterwards. The card widens to `max-w-2xl` — the width `sources/[id].astro`
already uses — because it now carries four sections instead of three.

Phase 2 adds deletion, reusing the arm-then-confirm shape regeneration established, with the
server-side `confirm` guard as the actual protection. The endpoint deletes one row and lets the FK
cascade take the cards, then removes the Storage object best-effort.

Deriving the deck label in a small pure module rather than inline in the template keeps the
fallback rule (a source with no cards has no first card) in one testable place, and matches how
S-03 split `csv.ts` from `anki-export.ts`.

## Critical Implementation Details

**Delete order is load-bearing, and the safe order is the counter-intuitive one.** The row goes
first and the Storage object second, best-effort. Removing the object first would mean a failure
between the two steps leaves a source row pointing at an image that no longer exists — a state the
`sources_screenshot_requires_image` check constraint cannot catch, because it only requires
`image_path` to be non-null, not that the object behind it exists. Generation on such a source fails
with `source-image-missing` and the user has a broken deck they cannot repair. Row-first inverts the
failure into an orphaned object: invisible, costing quota, but harmless to every user-facing flow.

**The deck label has no guaranteed source.** A source that has never been generated, or that
generated zero cards, has no first card. Both states already exist and are rendered distinctly by
`sources/[id].astro:46-47`, so the list must not assume `flashcards[0]` exists.

## Phase 1: Deck List on the Dashboard

### Overview

The dashboard becomes the deck view: every source as a row, grouped by learning direction, labelled
by its first card, with a kept-of-total count. Read-only — nothing in this phase can destroy
anything.

### Changes Required:

#### 1. Deck derivation module

**File**: `src/lib/decks.ts`

**Intent**: Turn the raw rows of the dashboard's query into the grouped, labelled structure the
template renders. Pure — no Supabase, no Astro — so the label fallback and the grouping rule live in
one place rather than inside a template expression.

**Contract**: Exports a `Deck` shape (source id, pair, label, kept count, total count, created_at)
and a `DeckGroup` shape (the pair plus its decks). Exports a function taking the query's row shape
and returning `DeckGroup[]`, ordered by pair and, within each group, newest first. The label is the
first card's front by `created_at`; a source with no cards falls back to a fixed phrase rather than
an empty string. Kept is `discarded === false`, the same definition the schema comment and S-03's
export both use.

#### 2. Dashboard query, grouping, and layout

**File**: `src/pages/dashboard.astro`

**Intent**: Fetch each source with its cards in one round trip, hand the rows to `decks.ts`, and
render the groups below the upload form. Widen the card so four sections fit.

**Contract**: One embedded select over `sources` pulling `id, learned_language, known_language,
created_at` plus nested `flashcards(front, discarded, created_at)`, ordered by
`learned_language`, `known_language`, then `created_at` descending, with the nested rows ordered by
their own `created_at` ascending. RLS scopes both sides; no `user_id` filter, matching every other
query in the app. A query error must not silently render an empty list — surface it the way the
S-03 review taught, rather than letting a failure look like "no decks".

Each deck row is an anchor to `sourceUrl(id)` showing the label, the pair, and "N of M kept". The
section renders an explanatory panel when the user has no sources at all. The outer card's
`max-w-md` becomes `max-w-2xl`, matching `sources/[id].astro:57`; section separation keeps the
existing `border-t border-white/10 pt-6` pattern.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- Two sources under different pairs render as two groups, each labelled by its first card's front
- Counts read correctly after discarding some cards and saving
- A never-generated source and a zero-card source both render with the fallback label, not blank
- Clicking a deck opens that source's review screen
- A brand-new account sees the explanatory panel, not an empty region
- The widened dashboard still reads correctly on a narrow phone viewport
- A second account sees only its own decks

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 2: Delete a Source

### Overview

A source becomes deletable from its own page, taking its flashcards (by FK cascade) and its stored
screenshot (explicitly) with it.

### Changes Required:

#### 1. Delete outcome codes

**File**: `src/lib/source-errors.ts`

**Intent**: Give deletion the same typed outcome vocabulary every other endpoint uses.

**Contract**: Extend `SourceErrorCode` with `delete-confirm-required` and `delete-failed`, adding
their copy to `SOURCE_ERROR_MESSAGES` — the `Record` makes a missing message a compile error. Add a
`SOURCE_DELETED_CODE` success code with copy, and include it in the `SourceSuccessCode` union and
`sourceSuccessMessage`'s switch.

#### 2. Delete endpoint

**File**: `src/pages/api/sources/[id]/delete.ts`

**Intent**: Delete one source row, letting the FK cascade take its cards, then remove the stored
screenshot best-effort.

**Contract**: `POST` handler with the same in-handler auth guard as its siblings — `/api/*` is
outside the middleware's `PROTECTED_ROUTES`. Reads the source's `image_path` before deleting, since
it is unrecoverable afterwards. Refuses without `confirm=delete` in the form body, returning
`delete-confirm-required`, and that check runs before anything is destroyed. Deletes the `sources`
row only — the cards follow by cascade, and deleting them explicitly would be redundant. On a
delete failure, redirects back to the source with `delete-failed`. On success, removes the bucket
object without blocking on the result (see Critical Implementation Details for why this order), then
redirects to `dashboardUrl({ success: SOURCE_DELETED_CODE })`; the middleware's pair recall
re-attaches the pair and carries the success param.

#### 3. Delete control

**File**: `src/components/sources/DeleteSourceForm.tsx`

**Intent**: The arm-then-confirm control, mirroring `RegenerateForm` so the app has one shape for
destructive actions.

**Contract**: Props are the source id and its card count. Renders a real `<form method="POST">`
targeting the delete route with a hidden `confirm=delete` field. The first submit is prevented and
arms a warning naming what will be destroyed — the cards and the screenshot, permanently; the second
submits. As with `RegenerateForm`, this UI is the courtesy and the endpoint's guard is the
enforcement.

#### 4. Delete section on the source page

**File**: `src/pages/sources/[id].astro`

**Intent**: Offer deletion where the user can see what they are destroying.

**Contract**: Render `DeleteSourceForm` in its own `border-t` section below the export and
regenerate controls, passing the already-loaded `cards.length` — no new query. The section renders
for any existing source, including one with no cards, since a never-generated source is exactly the
kind a user wants to remove. The page's existing `?error=` banner renders the new codes unchanged,
because it goes through `sourceErrorMessage`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- The first click warns and does not delete; the second deletes and lands on the dashboard with a confirmation
- The deleted deck is gone from the dashboard list and its cards are gone from the database
- The source's object is no longer in the `screenshots` bucket
- Posting to the delete route without the confirm field deletes nothing and returns the confirm-required banner
- A never-generated source can be deleted
- Deleting another user's source id changes nothing and reveals nothing
- Deleting the last source in a pair group removes the whole group, and deleting the last source overall shows the empty panel again

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

No test framework, and this slice does not add one — nothing here is a pure-logic rule of the kind
that justified S-03's smoke script, with one exception noted below.

### Script-verified:

- Nothing new. `npm run csv:smoke` must keep passing, since Phase 1 touches the dashboard that S-03's
  export block lives on.

### Manual Testing Steps:

1. Add two screenshots under different language pairs; generate cards for both.
2. Discard one card in one deck and save; confirm the dashboard's count reflects it.
3. Confirm two groups render, each labelled by its deck's first card.
4. Add a third source and do not generate; confirm it appears with the fallback label.
5. Open a deck from the list; confirm it is the right source.
6. Delete that source: confirm the warning appears first, the second click completes, and the
   dashboard no longer lists it.
7. Check the `screenshots` bucket for the deleted source's object; it should be gone.
8. Post to the delete endpoint without `confirm=delete`; confirm nothing is destroyed.
9. Sign in as a second account and confirm its dashboard lists only its own decks.

## Performance Considerations

The deck list is one indexed read — `sources_user_id_idx` and `flashcards_source_id_idx` both exist
from F-01 — and it replaces no existing query, so the dashboard goes from two round trips to three
(auth, kept count, decks).

**PostgREST caps a response at `max_rows` (1000, `supabase/config.toml:18`), and this query is
deliberately not paged.** That is a considered departure from what S-03's review concluded about the
export routes, not an oversight. The difference is what truncation does: a short export file silently
loses cards the user believes they exported, whereas a short deck list is visible — old decks are
simply absent from a screen the user is looking at. A user with over 1000 sources is outside this
product's shape, and if it ever happens the failure is noticeable and non-destructive.

Nested `flashcards` rows are not subject to the same cap; a source's cards are bounded by S-02's
`MAX_CARDS` of 15 regardless.

## Migration Notes

None. This slice adds no columns and alters no tables. FR-006's cascade is already in the schema
from F-01. Deletion is irreversible by design — there is no soft-delete and no undo — so a rollback
of this code does not restore anything a user deleted while it was live.

## References

- Roadmap slice: `context/foundation/roadmap.md:121-131` (S-04)
- Cascade guarantee: `supabase/migrations/20260723162258_init_sources_flashcards.sql:45-50`
- Destructive-action pattern to copy: `src/components/cards/RegenerateForm.tsx` + `src/pages/api/sources/[id]/generate.ts:76-91`
- Best-effort Storage cleanup precedent: `src/pages/api/sources.ts:80-84`
- Outcome-code pattern: `src/lib/source-errors.ts`
- Pure-module split precedent: `src/lib/csv.ts` / `src/lib/anki-export.ts` (S-03)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Deck List on the Dashboard

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — 5b0e892
- [x] 1.2 Type checking passes: `npx astro check` — 5b0e892
- [x] 1.3 Build succeeds: `npm run build` — 5b0e892

#### Manual

- [x] 1.4 Two sources under different pairs render as two groups, each labelled by its first card's front — 5b0e892
- [x] 1.5 Counts read correctly after discarding some cards and saving — 5b0e892
- [x] 1.6 A never-generated source and a zero-card source both render with the fallback label, not blank — 5b0e892
- [x] 1.7 Clicking a deck opens that source's review screen — 5b0e892
- [x] 1.8 A brand-new account sees the explanatory panel, not an empty region — 5b0e892
- [x] 1.9 The widened dashboard still reads correctly on a narrow phone viewport — 5b0e892
- [x] 1.10 A second account sees only its own decks — 5b0e892

### Phase 2: Delete a Source

#### Automated

- [x] 2.1 Linting passes: `npm run lint`
- [x] 2.2 Type checking passes: `npx astro check`
- [x] 2.3 Build succeeds: `npm run build`

#### Manual

- [x] 2.4 The first click warns and does not delete; the second deletes and lands on the dashboard with a confirmation
- [x] 2.5 The deleted deck is gone from the dashboard list and its cards are gone from the database
- [x] 2.6 The source's object is no longer in the `screenshots` bucket
- [x] 2.7 Posting to the delete route without the confirm field deletes nothing and returns the confirm-required banner
- [x] 2.8 A never-generated source can be deleted
- [x] 2.9 Deleting another user's source id changes nothing and reveals nothing
- [x] 2.10 Deleting the last source in a pair group removes the whole group, and deleting the last source overall shows the empty panel again
