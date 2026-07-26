-- Migration: add screenshot source fields + screenshots bucket (S-01 · add-screenshot-source)
--
-- Additive follow-on to 20260723162258_init_sources_flashcards.sql. Extends `sources`
-- with the columns S-01 writes (type, learning direction, image path) and stands up the
-- project's first Storage bucket — a PRIVATE `screenshots` bucket whose objects are
-- readable/writable only by their owner, the Storage counterpart to the table's RLS.
--
-- Forward-only: no down path (a Vercel code rollback does not revert an applied migration).
--
-- Isolation depends on the app connecting with the ANON/publishable key (not service_role,
-- which bypasses RLS on both the table and storage.objects). See src/lib/supabase.ts.

-- ---------------------------------------------------------------------------
-- sources: feature columns
-- ---------------------------------------------------------------------------
-- `type` is added now (default 'screenshot') so S-05 (plain-text sources) is a purely
-- additive follow-on. `image_path` is nullable because plain-text sources have no image;
-- the check constraint keeps a screenshot row from existing without one.
-- `learned_language` / `known_language` are NOT NULL with no default — safe only because
-- the table is empty at this point (a populated table would need a backfill first).
alter table public.sources
  add column type             text not null default 'screenshot'
    check (type in ('screenshot', 'plaintext')),
  add column image_path       text,
  add column learned_language text not null,
  add column known_language   text not null,
  add constraint sources_screenshot_requires_image
    check (type <> 'screenshot' or image_path is not null);

comment on column public.sources.type is
  'Source kind: ''screenshot'' (S-01) or ''plaintext'' (S-05).';
comment on column public.sources.image_path is
  'Object path within the private ''screenshots'' bucket: {user_id}/{source_id}.{ext}. Null for non-image sources.';
comment on column public.sources.learned_language is
  'Foreign language being learned (translation source). Curated value from src/lib/languages.ts.';
comment on column public.sources.known_language is
  'Language the user already knows (translation target). Curated value from src/lib/languages.ts.';

-- ---------------------------------------------------------------------------
-- screenshots storage bucket (private) + owner-path-scoped RLS
-- ---------------------------------------------------------------------------
-- Private bucket; the 5 MB limit + png/jpeg allowlist mirror the shared app constant
-- (src/lib/upload-limits.ts) as the last line of defense. Idempotent for repeatable runs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('screenshots', 'screenshots', false, 5242880, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- Owner-only access, keyed on the first path segment being the owner's uid. The upload
-- endpoint MUST write objects at {user_id}/... for these policies to admit the write and
-- for per-user isolation to hold. storage.foldername(name) splits the object path on '/'.
create policy screenshots_owner_select
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy screenshots_owner_insert
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy screenshots_owner_update
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

create policy screenshots_owner_delete
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
