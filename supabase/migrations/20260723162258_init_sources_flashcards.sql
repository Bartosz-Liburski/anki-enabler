-- Migration: init sources & flashcards (F-01 · per-user-data-isolation)
--
-- Creates the two user-owned tables for the Anki-enabler product with row-level
-- security (RLS) enforcing per-user isolation. This is the FIRST migration for the
-- project and is deliberately minimal: the isolation contract only. Feature slices
-- (S-01, S-02, ...) add their own columns via additive migrations — do not edit this
-- file to add feature columns.
--
-- Forward-only: a Vercel code rollback does not revert an applied migration, so there
-- is intentionally no down path here.
--
-- Isolation depends on the app connecting with the ANON/publishable key (not the
-- service_role key, which bypasses RLS entirely). See src/lib/supabase.ts.

-- ---------------------------------------------------------------------------
-- sources
-- ---------------------------------------------------------------------------
create table public.sources (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.sources is
  'User-owned source material. Feature columns (type, learning direction, image path) are added by later slices.';

create index sources_user_id_idx on public.sources (user_id);

alter table public.sources enable row level security;

-- Flat user model: a user may do anything to their own rows and nothing to others'.
-- USING guards read/existing-row access; WITH CHECK guards new/updated rows.
create policy sources_owner_all
  on public.sources
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- flashcards
-- ---------------------------------------------------------------------------
-- user_id is carried directly (denormalized) so the RLS policy is a join-free
-- auth.uid() = user_id check rather than an EXISTS subquery through sources.
-- source_id ON DELETE CASCADE guarantees FR-006: deleting a source removes its cards.
create table public.flashcards (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  source_id  uuid        not null references public.sources (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.flashcards is
  'User-owned flashcards generated from a source. Feature columns (front, back, kept/discarded) are added by later slices.';

create index flashcards_user_id_idx on public.flashcards (user_id);
create index flashcards_source_id_idx on public.flashcards (source_id);

alter table public.flashcards enable row level security;

create policy flashcards_owner_all
  on public.flashcards
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
