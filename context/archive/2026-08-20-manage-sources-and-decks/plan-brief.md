# Browse and Manage Sources/Decks — Plan Brief

> Full plan: `context/changes/manage-sources-and-decks/plan.md`

## What & Why

Roadmap slice S-04. The dashboard becomes the app's deck view — every saved source appears as a
deck, grouped by learning direction — and a source becomes deletable, taking its flashcards and its
stored screenshot with it. This closes the app's biggest structural gap: until now there was no list
of anything, and `/sources/{id}` was reachable only by the post-upload redirect or a bookmark.

## Starting Point

S-01 and S-02 already write everything this needs: the pair, the cards, the `discarded` flag,
timestamps. FR-006's cascade is already guaranteed in the schema — `source_id ... ON DELETE CASCADE`
from F-01's init migration. What is missing is any screen that lists sources, any way to delete one,
and any cleanup of the private Storage object, which no FK reaches. `/sources` is inside the
middleware's guard but has no index page, so it 404s.

## Desired End State

A user opens the dashboard and sees their decks below the upload form, grouped under a heading per
learning direction, newest first. Each deck reads as its first card's front text with the pair and a
"3 of 5 kept" count beneath, and opens that source's review screen. On a source's page, a delete
control warns what it will destroy, arms on the first click, and on the second removes the source,
its cards, and its screenshot — landing back on the dashboard with the deck gone.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| List placement | On the dashboard | FR-005 rules out a separate source-browser screen, and the dashboard is already the app's only entry point. |
| Deck label | First card's front | Users recognize their own content; a date and a language pair are indistinguishable across ten screenshots of one lesson. |
| Counts | Kept of total | Names both the review state and the deck size, using the same "kept" definition S-03's export already relies on. |
| Ordering | Grouped by language pair | Delivers FR-011's grouping inside the list rather than as separate work, and the pair is how the app already thinks. |
| Delete confirmation | Arm-then-confirm, server-enforced | Copies regeneration's existing shape, where the endpoint refuses without the hidden field, so protection survives an unhydrated page. |
| Delete entry point | Source page only | The cards are on screen when the user confirms; a row-level delete would destroy cards they cannot see. |
| Storage cleanup | Delete row, then best-effort remove | Row-first turns a mid-failure into an invisible orphan instead of a source pointing at a missing image, which generation cannot recover from. |
| Empty state | Explanatory panel | Teaches what a deck is at the one moment the user has none. |
| Layout | Widen to `max-w-2xl` | The dashboard now carries four sections, and that width is already established on the source page. |
| Deck list paging | None, bounded at 1000 | A truncated list is visible and destroys nothing — unlike S-03's export, where truncation silently lost cards. |
| Schema | No migration | Every column this needs exists; no `title`, no `decks` table, no soft-delete. |

## Scope

**In scope:** a pure deck-derivation module; the dashboard's embedded query, pair grouping, deck
rows, empty panel, and widened layout; `POST /api/sources/[id]/delete` with a server-enforced
confirm; an arm-then-confirm island; best-effort Storage cleanup; two error codes and one success
code.

**Out of scope:** any migration or soft-delete; a `/sources` index page (FR-005); source editing
(PRD non-goal); delete from the deck list; bulk delete, undo, or trash; screenshot thumbnails
(private bucket means a signed URL per row); pagination or search over decks; a test framework.

## Architecture / Approach

```
dashboard.astro ──▶ one embedded select: sources + flashcards(front, discarded, created_at)
        │                     │
        │                     ▼
        │            src/lib/decks.ts — label, kept/total, group by pair (pure)
        ▼
   deck rows ──▶ /sources/{id} ──▶ DeleteSourceForm
                                          │  POST /api/sources/[id]/delete  (confirm=delete)
                                          ▼
                        delete sources row ▶ cards follow by FK cascade
                                          ▶ best-effort remove bucket object
```

One round trip carries each source and its cards, so the label and both counts come from the same
query; grouping happens in memory afterwards. Deriving the label in a pure module keeps the
"source with no cards" fallback in one place, mirroring how S-03 split `csv.ts` from
`anki-export.ts`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Deck list | Grouped, labelled decks on a widened dashboard; empty panel | A query failure that renders as "no decks" rather than an error — the exact shape S-03's review caught |
| 2. Delete | Delete endpoint, confirm island, cascade + Storage cleanup | Delete order: object-first would leave a source pointing at a missing image, which nothing can repair |

**Prerequisites:** S-01 and S-02 merged (both `implemented`); access to the Supabase Storage browser
to verify the object is actually gone; two accounts to check isolation.
**Estimated effort:** ~2 sessions across 2 phases. No migration, no new dependency, no LLM call.

## Open Risks & Assumptions

- **Deletion is irreversible with no undo and no trash.** That is the chosen design, but it means a
  mis-click past two confirmations destroys a screenshot the user may not have elsewhere. The warning
  copy is doing real work.
- **The Storage cleanup is best-effort by design**, so orphaned objects can accumulate with nothing
  to detect or reap them. Accepted because the alternative failure — a source whose image is gone —
  is unrecoverable through the UI.
- **The deck label depends on generated content**, so a deck's name can change when the user
  regenerates. That is honest (the deck did change) but means labels are not stable identifiers.
- **The 1000-source ceiling is unpaged**, deliberately and against S-03's precedent. If deck lists
  ever truncate in practice, the fix is paging, not a redesign.

## Success Criteria (Summary)

- A user can find any saved source from the dashboard without a bookmark, and tell their decks apart
  at a glance.
- Deleting a source removes the deck, its cards, and its stored screenshot — verifiably, in the
  bucket as well as the database.
- A confirm-less POST to the delete route destroys nothing.
