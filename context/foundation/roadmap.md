---
project: "Anki enabler"
version: 1
status: draft
created: 2026-07-23
updated: 2026-07-23
prd_version: 1
main_goal: low-complexity
top_blocker: time
---

# Roadmap: Anki enabler

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

A self-directed language learner captures piles of screenshots (app exercises, grammar, lyrics, transcripts) but has to retype each item by hand to study it in a spaced-repetition tool. This product is the missing bridge: it reads a source, generates question/answer flashcards oriented in the learner's learned → known direction, lets them keep or discard each card, and exports the kept set to CSV for import into their existing SRS tool.

The product wedge — the one trait that, if removed, makes this indistinguishable from a generic AI chat tool — is that generation is grounded in the learner's *own* uploaded source and respects a *per-source* learning direction (e.g. Italian → Polish), reusing a translation already present in the source or producing one when absent. The riskiest assumption (the single belief that, if false, sinks the product) is that this generation is good enough that ≥ 75% of produced cards are worth keeping.

## North star

**S-02: user can generate flashcards from a screenshot and review them card-by-card (keep/discard)** — this is the validation milestone because it is where the ≥ 75%-kept quality bar is proven; every other slice only matters if generation clears this bar.

> North star, here, means the smallest end-to-end slice whose successful delivery would prove the core product hypothesis — placed as early as its prerequisites allow because everything downstream (export, browsing, extra source types) is only worth building if generation quality holds.

## At a glance

| ID   | Change ID                   | Outcome (user can …)                                                        | Prerequisites | PRD refs                        | Status   |
| ---- | --------------------------- | --------------------------------------------------------------------------- | ------------- | ------------------------------- | -------- |
| F-01 | per-user-data-isolation     | (foundation) sources & flashcards persist per user with enforced isolation  | —             | FR-001, NFR (no cross-user)     | ready    |
| S-01 | add-screenshot-source       | add a screenshot source and set its per-source learning direction           | F-01          | FR-002, FR-003, NFR (size cap)  | proposed |
| S-02 | generate-and-review-cards   | generate Q/A cards from a source, then review them keep/discard             | S-01          | FR-007, FR-008, FR-009, FR-010, US-01 | proposed |
| S-03 | export-kept-cards-csv       | export the kept flashcards to a CSV file                                    | S-02          | FR-012                          | blocked  |
| S-04 | manage-sources-and-decks    | browse sources/decks and delete a source (cascading its cards)              | S-01, S-02    | FR-005, FR-006, FR-011          | proposed |
| S-05 | add-plaintext-source        | add a plain-text file (lyrics, transcript) as a source                      | S-02          | FR-004                          | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme               | Chain                                   | Note                                                                          |
| ------ | ------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| A      | Core capture→review | `F-01` → `S-01` → `S-02`                | The must-have spine; ends at the north star. Everything else branches off it. |
| B      | Handoff             | `S-03`                                  | Joins Stream A at `S-02`; blocked until the CSV-format question resolves.      |
| C      | Library management  | `S-04`                                  | Joins Stream A at `S-02`; navigation/cleanup over the same data.              |
| D      | Extra source types  | `S-05`                                  | Joins Stream A at `S-02`; nice-to-have, parked-adjacent under the time budget. |

## Baseline

What's already in place in the codebase as of `2026-07-23` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 SSR + React 19 + Tailwind v4 + shadcn/ui; file-based routing with real pages at `src/pages/` (index, dashboard, auth).
- **Backend / API:** partial — Astro SSR API routes exist for auth only (`src/pages/api/auth/*`); no domain endpoints and **no LLM SDK dependency installed yet**.
- **Data:** absent — `@supabase/supabase-js` present, but no `supabase/migrations/`, no schema, no tables defined.
- **Auth:** present — Supabase SSR auth wired end-to-end: per-request client (`src/lib/supabase.ts`), middleware gating `/dashboard` (`src/middleware.ts`), signin/signup/signout routes, login pages. FR-001 is effectively satisfied by this scaffold.
- **Deploy / infra:** present — `@astrojs/vercel` adapter with `maxDuration: 60` (`astro.config.mjs`); GitHub Actions CI (`.github/workflows/ci.yml`). Per `infrastructure.md`: Vercel Hobby, Node serverless, Fluid Compute for the long LLM call.
- **Observability:** absent — no logging library, error tracking, or metrics wired.

## Foundations

### F-01: Per-user data isolation for sources & flashcards

- **Outcome:** (foundation) the `sources` and `flashcards` persistence exists with row-level per-user isolation enforced, so a signed-in user's data is readable/writable only by them.
- **Change ID:** per-user-data-isolation
- **PRD refs:** FR-001 (account-scoped ownership of data), NFR ("a user's sources and generated flashcards are never visible to any other user")
- **Unlocks:** S-01 (first slice that writes user-owned data); establishes the verification path for the "no cross-user access" NFR that every subsequent data slice relies on.
- **Prerequisites:** — (auth is already present per Baseline)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced first because the privacy NFR gates launch and cross-user data leakage is the #1 risk in `infrastructure.md`'s pre-mortem (module-scope client reuse leaking sessions). Kept minimal — this establishes the isolation contract and the two tables the first slice needs, not a complete data layer; S-01/S-02 still add their own columns and exercise the tables through user features.
- **Status:** ready

## Slices

### S-01: Add a screenshot source and set its learning direction

- **Outcome:** user can upload a screenshot as a source and set that source's learning context (foreign language being learned + language(s) already known), which fixes the translation direction for later generation.
- **Change ID:** add-screenshot-source
- **PRD refs:** FR-002, FR-003, NFR ("a source whose size or length exceeds the published input limit is rejected before any generation runs")
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Where do uploaded images live and how is the size cap enforced at upload time? — Owner: TBD (resolve in `/10x-plan`). Block: no.
- **Risk:** Sequenced before generation because a stored, context-tagged source is the input generation consumes. Kept simple per the low-complexity goal — upload + persist + a small learning-context form, no image processing beyond storage (per `infrastructure.md`, images go straight to Supabase Storage; the function stays orchestration-only).
- **Status:** proposed

### S-02: Generate flashcards from a source and review them (keep/discard)

- **Outcome:** user can trigger generation for a source and get capped Q/A flashcards oriented learned → known (reusing an in-source translation when present, producing one when absent), can re-generate to replace the set, and reviews the cards on a single screen — discarding weak ones; the rest are kept. A source yielding no usable cards shows an explanatory state, not a silent empty result.
- **Change ID:** generate-and-review-cards
- **PRD refs:** FR-007, FR-008, FR-009, FR-010, US-01, NFR (input size cap / cost bound)
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Which LLM provider/model, and how is the per-source card-count cap enforced so cost stays bounded? — Owner: TBD (resolve in `/10x-plan`). Block: no.
  - How is the ≥ 75%-kept quality bar measured/validated in practice? — Owner: user. Block: no.
- **Risk:** This is the north star and carries the product's riskiest assumption (generation quality). Sequenced as early as prerequisites allow. The LLM capability (SDK, API key, `maxDuration`/Fluid-Compute setup, input caps) is introduced here — its first and only consumer — rather than as a separate foundation, keeping the technical surface progressive. Watch the Vercel Fluid-Compute timeout footgun from `infrastructure.md`.
- **Status:** proposed

### S-03: Export kept flashcards to CSV

- **Outcome:** user can export the kept flashcards (those not discarded) to a CSV file suitable for import into their SRS tool.
- **Change ID:** export-kept-cards-csv
- **PRD refs:** FR-012
- **Prerequisites:** S-02
- **Parallel with:** S-04, S-05
- **Blockers:** —
- **Unknowns:**
  - Exact CSV column layout — front/back order, delimiter, header row, tags/deck column — must match the target SRS import format. — Owner: user. Block: yes.
- **Risk:** Completes the core loop but is `blocked` until the CSV-layout Open Question resolves; an unspecified format produces an export nothing can import. Small once the format is decided.
- **Status:** blocked

### S-04: Browse and manage sources/decks

- **Outcome:** user can browse their saved sources through the deck view, see cards grouped by source/deck, and delete a source — which cascades to delete the flashcards generated from it.
- **Change ID:** manage-sources-and-decks
- **PRD refs:** FR-005, FR-006, FR-011
- **Prerequisites:** S-01, S-02
- **Parallel with:** S-03, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Navigation and cleanup over data that S-01/S-02 already create; no separate source-browser screen (sources surface via their deck, per FR-005). FR-011 (grouping) is nice-to-have and can be trimmed under the time budget without dropping the must-have delete/browse behaviour.
- **Status:** proposed

### S-05: Add a plain-text file as a source

- **Outcome:** user can add a plain-text file (song lyrics, video transcript) as a source, which then flows through the same generation → review → export pipeline.
- **Change ID:** add-plaintext-source
- **PRD refs:** FR-004
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Nice-to-have (FR-004); reuses the generation pipeline with a text input path instead of image. Under the `time` blocker and low-complexity goal this is the first candidate to slip past the MVP if the budget runs short — see Parked.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                 | Suggested issue title                                  | Ready for `/10x-plan` | Notes                                        |
| ---------- | ------------------------- | ------------------------------------------------------ | --------------------- | -------------------------------------------- |
| F-01       | per-user-data-isolation   | Per-user data isolation for sources & flashcards       | yes                   | Run `/10x-plan per-user-data-isolation`      |
| S-01       | add-screenshot-source     | Add a screenshot source + set learning direction       | no                    | Ready once F-01 lands                        |
| S-02       | generate-and-review-cards | Generate flashcards from a source + review keep/discard | no                    | North star; ready once S-01 lands            |
| S-03       | export-kept-cards-csv     | Export kept flashcards to CSV                          | no                    | Blocked on CSV-layout Open Question          |
| S-04       | manage-sources-and-decks  | Browse/manage sources & decks; delete cascades          | no                    | Ready once S-01 + S-02 land                  |
| S-05       | add-plaintext-source      | Add a plain-text file as a source                      | no                    | Nice-to-have; parked-adjacent under time     |

## Open Roadmap Questions

1. **Exact CSV export column layout** — front/back column order, delimiter, header row, and whether a tags/deck column is included; must match the target SRS import format (e.g. Anki). Owner: user. Block: S-03.
2. **Is manual flashcard creation (outside AI generation) in scope?** — not captured as an FR, not ruled out as a non-goal. Owner: user. Block: roadmap-wide (default if unresolved: out of scope for v1, generation-only — so it stays absent from slices unless promoted).

## Parked

- **Plain-text file sources (FR-004)** — Why parked: nice-to-have per PRD; sequenced as S-05 but first to slip if the 3-week after-hours budget runs short (top blocker: time).
- **Grouping/browsing by source or deck (FR-011)** — Why parked: nice-to-have; folded into S-04 but trimmable without losing the must-have delete/browse behaviour.
- **Own spaced-repetition / scheduling algorithm** — Why parked: PRD §Non-Goals — the product exports to existing SRS tools; it does not schedule reviews.
- **Complex media import (video, audio, PDF)** — Why parked: PRD §Non-Goals — only screenshot images and plain-text files, with an enforced size limit.
- **Complex export formats (e.g. Anki `.apkg`)** — Why parked: PRD §Non-Goals — CSV export only in v1.
- **Social / sharing / messaging features** — Why parked: PRD §Non-Goals — no cross-user interaction.
- **Source editing** — Why parked: PRD §Non-Goals — sources are add/delete only (delete + re-add to change one).
- **In-place flashcard editing** — Why parked: PRD §Non-Goals — review is keep/discard only; discarding is the sole curation action.
- **Native mobile/desktop app, offline mode, UI localization** — Why parked: PRD §Non-Goals — web-only, online-only, single-language UI in v1.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived. Do NOT pre-populate.)
