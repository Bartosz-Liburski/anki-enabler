# Export Kept Flashcards to CSV Implementation Plan

## Overview

Roadmap slice S-03 closes the core loop. A user who has generated and reviewed flashcards can
download the ones they kept as a CSV file that imports into Anki without touching the import
dialog — either for a single source or for their whole account.

This is a pure read over data S-02 already writes. There is no migration, no LLM call, and no new
dependency. The weight of the slice is in the file format: the roadmap parked S-03 as `blocked`
precisely because "an unspecified CSV format produces an export nothing can import"
(`roadmap.md:118`). That question is resolved here.

## Current State Analysis

**What exists.** `flashcards` carries `front`, `back`, and `discarded`, and the migration that
added them states the export contract outright: *"Kept is the COMPLEMENT of this: a kept card is
simply `discarded = false` (S-03 exports those)"*
(`supabase/migrations/20260731075155_add_flashcard_fields.sql:29`). `sources` carries
`learned_language` / `known_language` as ISO 639-1 codes drawn from a curated list
(`src/lib/languages.ts:16`). Both tables are under per-user RLS from F-01, and `flashcards` has an
FK to `sources` that the generated types expose as a relationship
(`src/db/database.types.ts:70-76`), so an embedded select can fetch a card and its source's
language pair in one round trip.

**What is missing.** Nothing reads this data for export, and there is no route in the app that
returns a file. Every endpoint to date is `POST` form data → `context.redirect(...)` carrying an
outcome code (`src/lib/source-errors.ts:12`).

**The navigation constraint.** There is still no source list. `dashboard.astro` renders only the
upload form, and `/sources/{id}` is reachable solely by the post-upload redirect or a bookmark —
browsing is S-04's job. That is why this slice ships *two* entry points rather than one: the
per-source download on the page the user is already on, and an account-wide download on the
dashboard so a user with several sources is not forced to hunt for URLs S-04 hasn't built yet.

**Verification surface.** There is no test framework. CI runs `npx astro sync`, `npm run lint`,
`npm run build` (`.github/workflows/ci.yml`). The precedent for verifying pure logic without a test
framework is S-02's `scripts/eval-cards.ts` driven by `npm run eval` through `tsx`.

## Desired End State

A user viewing a source with kept cards sees a download link. Clicking it downloads
`anki-enabler-it-pl-2026-08-11.csv`. Dragging that file into Anki imports every kept card as a
Basic note — front in the language being learned, back in the language they know — tagged
`anki-enabler::it-pl`, with no separator, notetype, or field-mapping choices to make and no text
lost to HTML stripping. The dashboard offers the same thing across every source at once, each row
carrying its own pair tag so the user can split the deck by tag afterwards.

A source (or an account) with nothing kept shows no download link at all, and the URL cannot be
poked directly into producing an empty file.

**How to verify:** generate cards for a source, discard some, save, download, and import the file
into a real Anki install. The imported note count equals the kept count, the tag appears in Anki's
sidebar under `anki-enabler`, and a card whose text contains a comma or an angle bracket survives
intact.

### Key Discoveries:

- **"Kept" is already defined in the schema**, and S-03 is named as its consumer —
  `supabase/migrations/20260731075155_add_flashcard_fields.sql:29`. No new column, no migration.
- **Language codes are safe by construction.** `sources.learned_language` / `known_language` are
  validated against `LANGUAGES` at write time (`src/lib/languages.ts:48`), so every stored value is
  a lowercase ISO 639-1 alpha-2 code. That makes both the Anki tag and the filename injection-free
  without a sanitizer.
- **Astro maps `export.csv.ts` to `/…/export.csv`** — it strips only the final `.ts`, the same
  mechanism that makes `rss.xml.ts` serve `/rss.xml`. No rewrite or custom route config needed.
- **The dashboard's error banner is misplaced for this slice.** In the `pairReady` branch,
  `dashboard.astro:79` funnels `?error=` into `AddSourceForm`'s `serverError` prop, so an export
  failure would render attached to the upload form. Phase 3 renders export errors in their own
  banner instead.
- **Redirecting to a bare `/dashboard?error=…` already survives the middleware.**
  `dashboardPairUrl` carries `error` / `success` across the pair-recall redirect
  (`src/lib/source-pair.ts:81-84`), so the account-wide endpoint does not need to re-attach the pair.
- **The review screen already holds every card it needs.** `sources/[id].astro:31` selects
  `discarded` for the whole set, so gating the link on the kept count costs zero extra queries.

## What We're NOT Doing

- **No schema change.** No `exported_at`, no "already exported" flag, no migration. Export is a
  stateless read; re-exporting is always safe and produces the same file.
- **No `.apkg` or any non-CSV format** — PRD §Non-Goals (`prd.md:120`).
- **No deck column.** Sources have no title, only a UUID and a language pair; a UUID deck name is
  worse than letting Anki use its default deck. Cards are separated by tag instead.
- **No source browsing or deletion** — S-04.
- **No export of discarded cards**, and no UI to change what "kept" means. Discard remains the only
  curation action.
- **No card editing before export** — PRD §Non-Goals.
- **No BOM, no Excel-first concessions.** Anki is the stated target format consumer.
- **No test framework.** Phase 1 adds one smoke script in the shape S-02 established, nothing more.

## Implementation Approach

Three phases, each independently shippable:

1. A pure serialization layer with no I/O — RFC-4180 escaping split from Anki-specific knowledge,
   so the escaping rules can be exercised by a script with no database, no Astro, and no network.
2. The per-source download route and its link, which is the complete feature for a single-source
   user.
3. The account-wide download route and its dashboard link, which is the same serializer over a
   wider query.

The split between `csv.ts` and `anki-export.ts` mirrors how S-02 separated `card-schema.ts` /
`prompt.ts` / `generate-cards.ts`: the generic mechanism stays ignorant of the domain layered on it.

Both routes are `GET` endpoints answering with a file body rather than the codebase's usual
`POST` → redirect. Export is a read, so `GET` says what it means and the control is a bare `<a>`
that works with no hydration — consistent with the progressive-enhancement stance
`ReviewCardList.tsx:22-30` documents for the review form.

## Critical Implementation Details

**Anki directives are version-floored and order-sensitive.** The `#separator:`, `#html:`,
`#notetype:`, and `#tags column:` lines must be the first lines of the file, before any data row.
They are honoured by Anki 2.1.55 and newer; an older Anki imports them as notes. `#html:false` is
the load-bearing one — without it Anki treats every field as HTML, so a card containing `<` or `&`
silently loses text on import, and that failure is invisible until the user studies the card.

**No BOM.** Anki requires UTF-8, and a byte-order mark ahead of `#separator:comma` risks the first
directive not being recognised. The consequence is accepted: opening the file in Excel on a
non-UTF-8 default will show mojibake for accented characters. Anki is the target.

**Anki tags cannot contain spaces** — a space starts a new tag. `anki-enabler::it-pl` is legal
because the language codes are curated alpha-2 values (see Key Discoveries), so this holds without
runtime escaping. The `::` is Anki's hierarchy separator, which is what puts every export under one
`anki-enabler` parent in the sidebar.

**Ordering matters for the account-wide file.** Order by `source_id`, then `created_at`, so each
source's cards stay contiguous in the file. The per-source route orders by `created_at` only,
matching the order the review screen already displays (`sources/[id].astro:33`).

## Phase 1: Serialization Module

### Overview

The two pure modules that turn a list of kept cards into Anki-ready CSV text, plus the script that
proves the escaping is right. No Supabase, no Astro, no I/O — which is exactly what lets the script
drive them from plain Node.

### Changes Required:

#### 1. RFC-4180 serializer

**File**: `src/lib/csv.ts`

**Intent**: Generic, domain-free CSV serialization. Knows nothing about Anki or flashcards — it
turns rows of strings into RFC-4180 text so the escaping rules live in exactly one place and can be
exercised in isolation.

**Contract**: Exports a field-escaping function and a row/document serializer over
`readonly string[][]`. Escaping wraps a field in double quotes when it contains the delimiter, a
double quote, CR, or LF, and doubles any embedded double quote. Records terminate with CRLF per the
spec. The delimiter is a parameter defaulting to `,` — not hardcoded — so a future format change
does not mean rewriting the escaping.

#### 2. Anki export layer

**File**: `src/lib/anki-export.ts`

**Intent**: Everything Anki-specific: the directive block, the tag derived from a language pair, the
download filename, and the mapping from kept-card rows to CSV rows. Sits on `csv.ts` and is the
single place the format is spelled, the way `source-errors.ts` is the single place outcome codes
are spelled.

**Contract**: Exports an `ExportCard`-shaped input carrying `front`, `back`, `learnedLanguage`,
`knownLanguage`; a pair-to-tag function producing `anki-enabler::<learned>-<known>`; a filename
builder taking an optional pair (present for per-source, absent for account-wide) plus a date and
producing `anki-enabler-it-pl-2026-08-11.csv` / `anki-enabler-all-2026-08-11.csv`; and a builder
turning `ExportCard[]` into the finished document. Columns are `front`, `back`, `tags` in that
order. The directive block is emitted verbatim ahead of the rows:

```
#separator:comma
#html:false
#notetype:Basic
#tags column:3
```

Also export the MIME type string used by both routes, so `text/csv; charset=utf-8` is written once.

#### 3. Escaping smoke script

**File**: `scripts/csv-smoke.ts`

**Intent**: Assert the escaping cases that a manual click-through cannot reach, in a repo with no
test framework. Modelled on `scripts/eval-cards.ts` — a `tsx` script run through an npm script,
exiting non-zero on failure.

**Contract**: Asserts, at minimum: a field containing the delimiter is quoted; an embedded double
quote is doubled and the field quoted; a field containing LF or CRLF is quoted and round-trips; a
field whose text begins with `#` is emitted as a data row and not mistaken for a directive; a plain
field is left unquoted. Prints a sample document on success and exits 0; throws with the failing
case on mismatch.

#### 4. Script registration

**File**: `package.json`

**Intent**: Make the smoke script runnable the same way `npm run eval` is.

**Contract**: Add `"csv:smoke": "tsx scripts/csv-smoke.ts"` to `scripts`. No `--env-file` flag —
unlike the eval harness this script needs no secrets.

### Success Criteria:

#### Automated Verification:

- Escaping smoke script passes: `npm run csv:smoke`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- The sample document printed by `npm run csv:smoke`, saved as a `.csv` and imported into a real
  Anki install, lands as Basic notes with the tag visible in the sidebar and no import-dialog
  choices required.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 2: Per-Source Export

### Overview

The download route for one source's kept cards, and the link that reaches it. This is the complete
feature for a user working through a single source — Phase 3 only widens it.

### Changes Required:

#### 1. Export outcome codes

**File**: `src/lib/source-errors.ts`

**Intent**: Give the export path the same typed outcome vocabulary every other endpoint uses, so a
renamed code breaks type checking rather than rendering a blank banner.

**Contract**: Extend `SourceErrorCode` with `export-empty` and `export-failed`, and add their copy
to `SOURCE_ERROR_MESSAGES` — the `Record` type makes a missing message a compile error. No success
code is needed: success is the file itself, not a redirect.

#### 2. Per-source export route

**File**: `src/pages/api/sources/[id]/export.csv.ts`

**Intent**: Answer a `GET` with the source's kept cards as an Anki CSV attachment.

**Contract**: `GET` handler. Auth is checked in the handler, not the middleware — `/api/*` is
outside `PROTECTED_ROUTES` (`src/middleware.ts:7`), the same reason `generate.ts:42` and
`review.ts:24` carry their own guard; an unauthenticated request redirects to `/auth/signin`.
Selects the source's `learned_language` / `known_language` (a missing row redirects to the
dashboard with `source-not-found`, since RLS makes "not yours" and "not there" indistinguishable —
and deliberately so, per `source-errors.ts:42-44`), then its flashcards filtered on
`discarded = false`, ordered by `created_at` ascending. Zero rows redirects to `sourceUrl(id, {
error: "export-empty" })`; a query error redirects with `export-failed`. On success responds
`200` with the built document, `Content-Type` from `anki-export.ts`, and
`Content-Disposition: attachment; filename="<built filename>"`.

#### 3. Download link on the source page

**File**: `src/pages/sources/[id].astro`

**Intent**: Offer the download exactly when there is something to download, and render an export
error where the user can see it.

**Contract**: Derive a kept count from the already-loaded `cards` array — no new query. Render a
plain `<a href={/api/sources/${id}/export.csv}>` inside the existing cards-present branch
(`sources/[id].astro:142`), alongside the regenerate control, only when that count is above zero.
Styling follows the existing anchor pattern on the same page. The `?error=` banner at line 98
already renders the new codes with no change, because it goes through `sourceErrorMessage`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Escaping smoke script still passes: `npm run csv:smoke`

#### Manual Verification:

- A source with kept cards shows the download link; clicking it downloads a file named for the pair
  and today's date.
- Discarding every card and saving makes the link disappear; requesting the URL directly then
  returns to the page with the "nothing kept" banner rather than an empty file.
- Discarded cards are absent from the downloaded file; the row count equals the kept count.
- The file imports into Anki with no dialog choices, and a card containing a comma or an angle
  bracket survives intact.
- Requesting another user's source id returns the same "doesn't exist" outcome as a made-up one.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 3: Account-Wide Export

### Overview

The same serializer over every kept card the user owns, reachable from the dashboard — the entry
point that keeps export usable before S-04 builds source browsing.

### Changes Required:

#### 1. Account-wide export route

**File**: `src/pages/api/export.csv.ts`

**Intent**: Answer a `GET` with every kept card across all of the user's sources, each row tagged
with its own source's language pair.

**Contract**: `GET` handler with the same in-handler auth guard as Phase 2. One query over
`flashcards` filtered on `discarded = false`, embedding the parent source's `learned_language` /
`known_language` through the FK relationship the generated types already expose
(`database.types.ts:70-76`) — RLS scopes both sides to the owner. Ordered by `source_id`, then
`created_at`, so each source's cards stay contiguous. Zero rows redirects to
`dashboardUrl({ error: "export-empty" })`; a query error redirects with `export-failed`. The
middleware's pair-recall re-attaches the language pair to that bare dashboard URL and carries the
`error` param across (`source-pair.ts:81-84`), so no pair needs attaching here. On success responds
with the document, the shared MIME type, and `Content-Disposition: attachment` naming the
`anki-enabler-all-<date>.csv` variant.

#### 2. Dashboard link and its own error banner

**File**: `src/pages/dashboard.astro`

**Intent**: Surface the account-wide download when the user has anything kept, and stop export
errors from rendering as if the upload form had failed.

**Contract**: Add a head-only count query over `flashcards` filtered on `discarded = false` (RLS
scopes it to the user). Render a plain `<a href="/api/export.csv">` in the bottom action row beside
the existing dashboard links (`dashboard.astro:103`), only when that count is above zero, labelled
with the count so the user knows what they are getting. Route the two `export-*` codes to a
dedicated banner rendered near that link, rather than into `AddSourceForm`'s `serverError` prop
(`dashboard.astro:79`) — the existing branch keeps handling every other code exactly as it does
today.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- Escaping smoke script still passes: `npm run csv:smoke`

#### Manual Verification:

- With kept cards across two sources in different language pairs, the dashboard shows the export
  link with the correct total; the downloaded file contains every kept card, each row carrying its
  own source's pair tag, with each source's cards contiguous.
- Importing that file into Anki produces two tags under `anki-enabler`, and filtering by one tag
  isolates that source's cards.
- An account with nothing kept shows no link; requesting `/api/export.csv` directly then returns to
  the dashboard with the "nothing kept" banner, and the banner appears near the export link rather
  than attached to the upload form.
- A second account sees only its own cards in its own export.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

There is no test framework in this repo, and this slice does not add one. Verification splits along
the same line S-02 drew: pure logic gets a script, everything touching Supabase or Anki gets manual
steps.

### Script-verified (`npm run csv:smoke`):

- Field containing the delimiter is quoted.
- Embedded double quote is doubled and its field quoted.
- Field containing LF / CRLF is quoted and round-trips.
- Field whose text starts with `#` is emitted as data, not mistaken for a directive.
- Plain field is left unquoted.
- Directive block precedes every data row.

### Manual Testing Steps:

1. Generate cards for a source, discard some, save.
2. Download the per-source file; confirm the row count equals the kept count and discarded cards
   are absent.
3. Import into a real Anki install; confirm the note count matches, the tag appears under
   `anki-enabler`, and no import-dialog choices were required.
4. Confirm a card containing a comma, a double quote, and an angle bracket survives the round trip
   intact — the angle bracket is the `#html:false` check.
5. Discard every card, save, and confirm the link disappears and the direct URL yields the banner.
6. Repeat 2–3 from the dashboard with two sources in different pairs; confirm per-row tags and
   contiguous grouping.
7. Sign in as a second account and confirm its export contains only its own cards.

## Performance Considerations

Both routes are single indexed reads — `flashcards_source_id_idx` covers the per-source query and
`flashcards_user_id_idx` the account-wide one, both from F-01's init migration. The response is
built in memory, which is correct at this scale: S-02 caps generation at 15 cards per source, so
even a heavy user's account-wide export is kilobytes. Streaming would be premature.

No LLM call, so `maxDuration: 60` is irrelevant here — these are the fastest routes in the app.

## Migration Notes

None. This slice adds no columns, alters no tables, and writes nothing. It can be deployed and
rolled back freely; a rollback simply removes the download links.

## References

- Roadmap slice: `context/foundation/roadmap.md:108-119` (S-03, and the Open Question it was blocked on)
- Upstream slice: `context/changes/generate-and-review-cards/plan.md` — where `discarded` and the review screen come from
- The export contract, stated in the schema: `supabase/migrations/20260731075155_add_flashcard_fields.sql:29`
- Outcome-code pattern to follow: `src/lib/source-errors.ts`
- Endpoint patterns (auth guard, RLS-scoped lookup, failure redirects): `src/pages/api/sources/[id]/review.ts`
- Script-without-test-framework precedent: `scripts/eval-cards.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Serialization Module

#### Automated

- [x] 1.1 Escaping smoke script passes: `npm run csv:smoke` — 8db6eed
- [x] 1.2 Linting passes: `npm run lint` — 8db6eed
- [x] 1.3 Build succeeds: `npm run build` — 8db6eed

#### Manual

- [x] 1.4 Sample document from the smoke script imports into Anki as Basic notes with the tag visible and no dialog choices — 8db6eed

### Phase 2: Per-Source Export

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — 0acc378
- [x] 2.2 Build succeeds: `npm run build` — 0acc378
- [x] 2.3 Escaping smoke script still passes: `npm run csv:smoke` — 0acc378

#### Manual

- [x] 2.4 Source with kept cards shows the link; download is named for the pair and today's date — 0acc378
- [x] 2.5 Discarding everything hides the link; the direct URL yields the "nothing kept" banner — 0acc378
- [x] 2.6 Discarded cards are absent; row count equals kept count — 0acc378
- [x] 2.7 File imports into Anki with no dialog choices; comma and angle-bracket cards survive intact — 0acc378
- [x] 2.8 Another user's source id yields the same outcome as a made-up one — 0acc378

### Phase 3: Account-Wide Export

#### Automated

- [x] 3.1 Linting passes: `npm run lint`
- [x] 3.2 Build succeeds: `npm run build`
- [x] 3.3 Escaping smoke script still passes: `npm run csv:smoke`

#### Manual

- [x] 3.4 Dashboard link shows the correct total; file carries every kept card with per-row pair tags, contiguous by source
- [x] 3.5 Import produces two tags under `anki-enabler`; filtering by one isolates that source's cards
- [x] 3.6 Empty account shows no link; direct URL yields the banner near the export link, not on the upload form
- [x] 3.7 A second account sees only its own cards
