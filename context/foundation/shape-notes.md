---
project: "Anki enabler"
context_type: greenfield
created: 2026-06-27
updated: 2026-06-27
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "workflow friction (manual transcription) + knowledge trapped in images + scattered/unorganized materials"
    - topic: "core insight"
      decision: "SRS tools (Anki) are mature and effective; the bottleneck is the INPUT — no convenient bridge from raw material to a ready flashcard"
    - topic: "primary persona scope"
      decision: "self-directed language learners (hobbyist niche) — many individual users"
    - topic: "auth strategy"
      decision: "account login (email + password or OAuth); flat user model — each user owns only their own sources and flashcards"
    - topic: "primary input type for v1"
      decision: "screenshots are the must-have core input (OCR is the main pain); plain-text file import is nice-to-have for v1"
    - topic: "learning-direction insight"
      decision: "user declares the language they are learning + language(s) they already know, so the AI knows the translation direction for generated flashcards (e.g. learning Italian, knows Polish → card translates Italian → Polish). This is the app's domain rule, not generic CRUD."
    - topic: "v1 editing scope (Socrates)"
      decision: "no in-place editing in v1 — source editing dropped (delete + re-add); flashcard editing dropped (review is keep/discard only). Both recorded as Non-Goals."
    - topic: "source deletion (Socrates)"
      decision: "deleting a source cascades to delete its generated flashcards"
    - topic: "generation caps (Socrates)"
      decision: "generation is bounded by both an input size/length cap and a per-source max card count"
  frs_drafted: 12
  quality_check_status: accepted
---

# Shape Notes — Anki enabler

> Seed idea captured from `context/mvp.md` (Polish). Shaping complete — ready for `/10x-prd`.
> Sections below are ordered to match the greenfield PRD schema so `/10x-prd` can map them 1:1.

## Vision & Problem Statement

A self-directed language learner accumulates hundreds of screenshots of
exercises (key expressions, grammar structures) plus plain-text files (song
lyrics, video transcripts). To actually study this material with spaced
repetition they must manually retype each item into Anki — a slow, repetitive
chore — and the source material itself stays scattered and unorganized, which
makes review ineffective. The cost is wasted time and lost learning momentum.

The insight: spaced-repetition tools like Anki are mature and effective — the
real bottleneck is the *input*. No tool conveniently bridges the gap from raw
captured material (an image, a transcript) to a ready-to-study flashcard. Now
that AI can reliably read text out of screenshots and shape it into
question/answer pairs, that bridge is finally buildable.

## User & Persona

Primary persona: a self-directed language learner (hobbyist niche). They study
a foreign language on their own, capturing material as they go — screenshots of
app exercises, lyrics, transcripts — with the intent to review it later in a
spaced-repetition app. They reach for this product at the moment they realize
their captured pile is too large and too scattered to retype by hand, and they
want it turned into reviewable flashcards with minimal manual effort.

_(Name not specified by user — role-based persona for now.)_

## Success Criteria

### Primary
- The full core loop works end-to-end: a user adds a screenshot source, the app
  generates question/answer flashcards from it, the user reviews them card-by-
  card (keeping or discarding each — no in-place editing in v1), and exports the
  kept flashcards to CSV.
- Quality bar (from the seed): the AI generates flashcards good enough that
  ≥ 75% (at least 3 of every 4) are kept — not discarded — and are suitable for
  export.

### Secondary
- Flashcards can be organized and browsed grouped by their source/deck. Nice
  to have for navigation; not sufficient on its own to call the MVP a success.

### Guardrails
- AI generation cost stays bounded: source inputs are capped in size/length so
  flashcard generation never runs up large costs, even if the rest works.

## User Stories

### US-01: User generates flashcards from a screenshot

- **Given** a logged-in user who has added a screenshot source and set that source's learning context (e.g. learning Italian, knows Polish)
- **When** they trigger flashcard generation for that source
- **Then** the app produces question/answer flashcards that render the screenshot's foreign-language material against a language the user knows, which they review card-by-card — discarding weak ones — and then export the kept cards to CSV

#### Acceptance Criteria
- At least 75% (3 of 4) of generated flashcards are kept (not discarded) and are suitable for export
- The translation direction of generated cards matches the source's learning context (learned language → known language)
- Generation respects the source size/length cap and the per-source card-count cap so cost stays bounded
- A source that yields no usable flashcards shows an explanatory state, not a silent empty result

## Functional Requirements

### Accounts
- FR-001: A user can create an account and sign in (email + password or OAuth). Priority: must-have
  > Socrates: Counter-argument considered: "auth is the most expensive non-core piece in a 3-week MVP; a local/single-user mode would ship faster." Resolution: kept as written — multi-user accounts are a deliberate product choice; plan to lean on a managed auth provider to keep build cost down.

### Learning context
- FR-002: A user can set, per source/deck, the foreign language being learned and the language(s) they already know, which sets the translation direction used when generating flashcards. Priority: must-have
  > Socrates: Counter-argument considered: "the AI could auto-detect the language pair, or a single global profile would suffice." Resolution: revised — the learned/known language pair is set per source/deck (a user may study several languages at once), not as one global profile.

### Sources
- FR-003: A user can add a source by uploading a screenshot image. Priority: must-have
  > Socrates: Counter-argument considered: "OCR on arbitrary screenshots is the riskiest quality element." Resolution: kept broad but added a guardrail — accept any image, but surface a low-confidence warning when text extraction is uncertain.
- FR-004: A user can add a source as a plain-text file (e.g. song lyrics, video transcript). Priority: nice-to-have
  > Socrates: Counter-argument considered: "drop .txt entirely to protect the 3-week timeline." Resolution: kept as nice-to-have — implemented only if time remains after the screenshot core works.
- FR-005: A user can browse their saved sources through the deck view (no separate source-browser screen). Priority: must-have
  > Socrates: Counter-argument considered: "is a dedicated source-list screen needed, or can sources surface through their flashcards?" Resolution: merged — sources are viewed via their deck; no separate source-browser screen in v1.
- FR-006: A user can delete a saved source; deleting a source cascades to remove the flashcards generated from it. Priority: must-have
  > Socrates: Counter-argument considered: "what happens to a source's flashcards when it is deleted?" Resolution: cascade — a source and its generated flashcards are removed together. (Source *editing* was dropped from v1; see Non-Goals.)

### Flashcard generation
- FR-007: A user can generate question/answer flashcards from a selected source, capped at a maximum number of cards per source. Priority: must-have
  > Socrates: Counter-argument considered: "a source could produce too many cards or junk." Resolution: cap the number of cards generated per source (alongside the input-size cost cap).
- FR-008: A user can re-generate the flashcards for a source. Priority: must-have
  > Socrates: Counter-argument considered: "regeneration could silently wipe user edits." Resolution: kept as written — moot in v1 because there is no in-place editing (review is keep/discard); regeneration simply replaces the generated set.
- FR-009: A user can review the flashcards generated from a source on a single review screen. Priority: must-have
  > Socrates: Counter-argument considered: "is a separate browse view needed, or is the review screen enough?" Resolution: merged into one review screen — no separate browse view.
- FR-010: A user can discard (delete) any generated flashcard during review; the kept cards are those not discarded. Priority: must-have
  > Socrates: Counter-argument considered: "if AI quality is high, is editing needed, or just keep/discard?" Resolution: v1 is keep/discard only — in-place flashcard editing was dropped (see Non-Goals); discard is the sole curation action.

### Organization
- FR-011: A user can group/browse flashcards by their source or deck. Priority: nice-to-have
  > Socrates: Counter-argument considered: "grouping is redundant if export already maps to source." Resolution: kept as nice-to-have for navigation when many sources exist.

### Export
- FR-012: A user can export the kept flashcards to a CSV file. Priority: must-have
  > Socrates: Counter-argument considered: "an unspecified CSV format produces an export nothing can import." Resolution: export kept; the exact CSV column layout is deferred to implementation and tracked in Open Questions.

## Non-Functional Requirements

- A user's sources and generated flashcards are never visible to any other user — no cross-user access at the product's outer boundary.
- A source whose size or length exceeds the published input limit is rejected before any generation runs, so flashcard-generation cost stays bounded.

## Business Logic

For each source, the app identifies the foreign-language items worth learning and produces question/answer flashcards that pair each item with its meaning in a language the user already knows — translating the item when the source carries no translation, or lifting the translation already shown in the source when one is present — following the learning direction set for that source.

Inputs (as the user supplies them): the raw content of a source (a screenshot image, or a plain-text file), plus that source's learning context — the foreign language being learned and the language(s) the user already knows. Some sources (e.g. screenshots from language-learning apps like Duolingo) already contain a translation alongside the foreign phrase; others (raw lyrics, transcripts) do not.

Output: a set of question/answer flashcards oriented in the learned → known direction. When a translation is already present in the source, the app extracts and reuses it rather than re-translating; when none is present, the app produces one.

How the user encounters it: the user adds a source, sets its learning context, triggers generation, and then reviews the produced deck card-by-card — keeping or discarding each — before exporting the kept cards.

## Access Control

Account-based login (email + password or OAuth). Flat user model: every
authenticated user is a regular user with no elevated roles. Each user can see
and manage only their own sources and generated flashcards — no shared or
cross-user visibility in the MVP. Unauthenticated visitors hitting a gated
route are sent to sign-in.

## Non-Goals

Functional non-goals:
- No own spaced-repetition / learning algorithm — the product hands cards off to existing SRS tools via export; it does not schedule reviews.
- No import or generation from complex media (video, audio, PDF) — only screenshot images and plain-text files are accepted, with an enforced size/length limit.
- No export of complex formats (e.g. Anki `.apkg`) — CSV export only in v1.
- No social or interaction features — no sharing of decks/sources, no messaging between users.
- No source editing in v1 — sources are add/delete only (delete and re-add to change one).
- No in-place flashcard editing in v1 — review is keep/discard only; the only curation action is discarding a card.

Non-functional non-goals:
- Web only — no native mobile or desktop app in v1.
- No offline mode — the app is online-only.
- No UI localization — the interface ships in a single language (distinct from the per-source flashcard translation direction, which is a core feature).

## Open Questions

1. **Exact CSV export column layout** — front/back column order, delimiter, header row, and whether a tags/deck column is included. Owner: user (resolve at implementation). Needs to match the target SRS import format (e.g. Anki).
2. **Is manual flashcard creation (outside AI generation) in scope?** — Not added as an FR and not ruled out as a non-goal; user left it undecided. Owner: user. Default if unresolved: out of scope for v1 (generation-only).
