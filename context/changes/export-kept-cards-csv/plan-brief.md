# Export Kept Flashcards to CSV — Plan Brief

> Full plan: `context/changes/export-kept-cards-csv/plan.md`

## What & Why

Roadmap slice S-03 closes the core loop: a user downloads the flashcards they kept during review as
a CSV that imports into Anki without touching the import dialog. The roadmap listed S-03 as
`blocked` on one question — the exact CSV layout, because "an unspecified CSV format produces an
export nothing can import." This plan resolves that question and then builds a small, migration-free
slice on top of it.

## Starting Point

S-02 left the export contract written into the schema itself: the `flashcards.discarded` comment
states that kept is the complement of that flag and names S-03 as its consumer. `front`, `back`,
and the source's ISO 639-1 language pair are all persisted and RLS-scoped. What is missing is any
route that returns a file — every endpoint so far is `POST` form data followed by a redirect — and
any way to reach a saved source other than the post-upload redirect, since source browsing is S-04.

## Desired End State

A user viewing a source with kept cards sees a download link. Clicking it yields
`anki-enabler-it-pl-2026-08-11.csv`, which drags into Anki as Basic notes tagged
`anki-enabler::it-pl` — no separator, notetype, or field-mapping choices, and no text lost to HTML
stripping. The dashboard offers the same across every source at once, each row carrying its own pair
tag so the deck can be split by tag afterwards. Nothing kept means no link at all, and the URL
cannot be poked into producing an empty file.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Export scope | Both per-source and account-wide | Source browsing is S-04, so a per-source link alone would strand a user with several sources. | Plan |
| Columns | `front, back, tags` | front→back matches Anki's Basic notetype exactly, and the tag is what keeps successive exports separable instead of one undifferentiated pile. | Plan |
| Tag value | `anki-enabler::it-pl`, one hierarchical tag | Anki's `::` gives the parent grouping for free; a bare `it::pl` would plant a top-level `it` in the user's tag tree. | Plan |
| Delimiter | Comma, RFC-4180 quoting | It is what FR-012 asks for, and quoting handles the commas that language phrases are full of. | Plan |
| File header | Anki directive block | Makes the file self-describing so the import dialog needs no guessing — and `#html:false` is what stops a card containing `<` from silently losing text. | Plan |
| Delivery | `GET` returning an attachment | Export is a read, and a bare `<a>` needs no hydration — matching the progressive-enhancement stance the review form already documents. | Plan |
| Filename | Pair + date | Meaningful in a Downloads folder months later; two exports on different days do not collide. | Plan |
| Empty export | Hide the control, guard the route | The user never reaches a dead end, and a bookmarked URL cannot produce a file Anki reports as "0 notes imported". | Plan |
| Export tracking | None — stateless read | Keeps the slice at zero schema change; incremental export stays available later as a purely additive migration. | Plan |
| No BOM | Accepted | A BOM ahead of `#separator:comma` risks the directive not being recognised; Anki is the target, not Excel. | Plan |
| Verification | One `tsx` smoke script | No test framework exists, and RFC-4180 escaping would otherwise be manual-only — same shape as S-02's eval harness. | Plan |

## Scope

**In scope:** an RFC-4180 serializer and an Anki export layer as separate pure modules; a smoke
script for the escaping cases; `GET /api/sources/[id]/export.csv` with a gated link on the source
page; `GET /api/export.csv` with a gated link and its own error banner on the dashboard; two new
outcome codes.

**Out of scope:** any migration or export-state tracking; `.apkg` or any non-CSV format (PRD
non-goal); a deck column (sources have no title, only a UUID); source browsing and deletion (S-04);
plain-text sources (S-05); card editing (PRD non-goal); a test framework.

## Architecture / Approach

```
src/lib/csv.ts            RFC-4180 escaping + serialization, delimiter-parameterized
        ▲                 (knows nothing about Anki)
src/lib/anki-export.ts    directives, pair→tag, filename, row mapping, MIME type
        ▲                 (the single place the format is spelled)
        ├── GET /api/sources/[id]/export.csv ──▶ link on /sources/{id}
        └── GET /api/export.csv               ──▶ link on /dashboard
```

Both routes are reads: auth-guard in the handler (`/api/*` is outside the middleware's
`PROTECTED_ROUTES`), an RLS-scoped query filtered on `discarded = false`, then the shared builder
and a `Content-Disposition: attachment` response. The account-wide route embeds the parent source's
language pair through the FK the generated types already expose, so one query covers both sides.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Serialization module | `csv.ts` + `anki-export.ts` + escaping smoke script | Directive syntax is version-floored at Anki 2.1.55; wrong syntax fails at import, not at build |
| 2. Per-source export | Route, outcome codes, gated link on the source page | A `GET` returning a file is a new shape here, so failures cannot use the usual redirect on the happy path |
| 3. Account-wide export | Route with per-row pair tags, gated dashboard link | The dashboard funnels `?error=` into the upload form's prop — export errors need their own banner |

**Prerequisites:** S-02 merged (kept cards exist to export); a real Anki install — 2.1.55 or newer —
to verify an actual import, which is the only check that proves the format decision was right.
**Estimated effort:** ~1–2 sessions across 3 phases. No migration, no new dependency, no LLM call.

## Open Risks & Assumptions

- **The format is verified only by a real Anki import.** Nothing in CI can prove the file imports
  correctly; if the manual check in Phase 1 fails, the directive block is the thing to change, and
  it is deliberately isolated in one module for exactly that reason.
- **Anki older than 2.1.55 will import the directive lines as notes.** Accepted — the alternative is
  losing `#html:false`, whose failure mode is silent text loss.
- **Excel will show mojibake** for accented characters given the no-BOM decision. Anki is the stated
  consumer; if spreadsheet-first use turns out to matter, the BOM decision reverses in one line.
- **The account-wide file mixes language pairs into one deck.** The per-row tag is the mitigation —
  the user splits by tag inside Anki. If that proves awkward in practice, the answer is S-04's
  browsing, not a deck column built on UUIDs.

## Success Criteria (Summary)

- A user with kept cards can download them and import the file into Anki with no dialog choices, and
  the imported note count equals the kept count.
- Cards containing commas, quotes, and angle brackets survive the round trip intact.
- A user with nothing kept is never offered a download that would produce an empty file.
