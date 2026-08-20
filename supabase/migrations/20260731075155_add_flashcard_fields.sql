-- Migration: add flashcard content fields + source generation state (S-02 · generate-and-review-cards)
--
-- Additive follow-on to 20260723162258_init_sources_flashcards.sql (do not edit that file).
-- Gives `flashcards` the columns a generated card needs plus the flag that expresses FR-010's
-- keep/discard, and gives `sources` somewhere to record the outcome of its last generation.
--
-- Forward-only: no down path (a Vercel code rollback does not revert an applied migration).
--
-- F-01's RLS policies (flashcards_owner_all, sources_owner_all), the source_id ON DELETE CASCADE
-- that guarantees FR-006, and the existing indexes are all untouched here. No new index is added:
-- flashcards_source_id_idx already covers the review screen's per-source query.

-- ---------------------------------------------------------------------------
-- flashcards: card content + curation flag
-- ---------------------------------------------------------------------------
-- `front` / `back` are NOT NULL with no default — safe only because this table is empty at this
-- point (nothing has ever written to it). A populated table would need a backfill first. Same
-- reasoning as S-01's learned_language / known_language.
alter table public.flashcards
  add column front     text    not null,
  add column back      text    not null,
  add column discarded boolean not null default false;

comment on column public.flashcards.front is
  'Prompt side of the card, in the source''s learned_language.';
comment on column public.flashcards.back is
  'Answer side of the card, in the source''s known_language.';
comment on column public.flashcards.discarded is
  'FR-010 curation flag. Kept is the COMPLEMENT of this: a kept card is simply discarded = false (S-03 exports those). Discard is the only curation action — cards are never edited.';

-- ---------------------------------------------------------------------------
-- sources: last-generation state
-- ---------------------------------------------------------------------------
-- All three are nullable, and the null is load-bearing: null in last_generated_at means NEVER
-- GENERATED, which is what distinguishes a fresh source from one that ran and legitimately
-- produced zero cards. The review screen branches on exactly that distinction.
alter table public.sources
  add column last_generated_at     timestamptz,
  add column generation_note       text,
  add column extraction_confidence text
    check (extraction_confidence in ('high', 'low'));

comment on column public.sources.last_generated_at is
  'When the last generation completed. NULL means never generated — not "generated and empty"; the review screen distinguishes the two on this column.';
comment on column public.sources.generation_note is
  'The model''s emptyReason, stored only when non-empty. This is what makes the explanatory zero-card state survive a page reload (FR-008).';
comment on column public.sources.extraction_confidence is
  'The model''s self-reported confidence in reading the image: ''high'' or ''low''. ''low'' drives FR-003''s warning banner. NULL until first generation.';
