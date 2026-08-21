-- Isolation test: per-user RLS on sources, flashcards & the screenshots Storage bucket (F-01, S-01)
--
-- Proves the launch-gating NFR: "a user's sources and generated flashcards are never
-- visible to any other user." Seeds two users, then — acting AS each user via a JWT claim —
-- asserts that no read/insert/update path crosses the user boundary, across BOTH the table
-- policies (sources_owner_all, flashcards_owner_all) and 3 of the 4 Storage bucket policies on
-- the private `screenshots` bucket (screenshots_owner_select/insert/update). The 4th
-- (screenshots_owner_delete) cannot be exercised via raw SQL on this platform — Supabase's
-- `storage.objects` carries a `protect_delete()` trigger that blocks ALL direct SQL DELETEs,
-- for every role, so the underlying object-store blob is never orphaned from its DB row.
-- Deletion only ever happens through the Storage API, so that policy is proven at the
-- application layer instead (Phase 4's IDOR integration tests, via the real Storage client).
--
-- HOW TO RUN (against the linked hosted project, via the Management API):
--   npm run test:rls
--   (wraps: npx supabase db query --file supabase/tests/isolation.sql --linked)
--
-- Real pgTAP (https://pgtap.org), not a hand-rolled DO block. The Management API's `db query`
-- only returns the FINAL statement's result set (no interleaved NOTICE output like a real
-- psql session would show) — so every assertion's own TAP output line is captured into a
-- temp table as it runs, and the last statement selects all of them back in order. That is
-- what makes a specific failure nameable instead of only "something in this file broke".
--
-- The `pgtap` extension is created INSIDE the transaction below, so `rollback` removes it
-- again — this never leaves a lasting change on the hosted project, the same way the fixture
-- rows never persist.
--
-- NOTE: auth.users' required columns vary by Supabase version. If the fixture insert fails
-- on a NOT NULL column, add it to the insert below — the isolation logic is unaffected.

begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

-- ---------------------------------------------------------------------------------------
-- Fixtures (as the privileged Management-API role; bypasses RLS)
-- ---------------------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated',
   'authenticated', 'user_a@isolation.test', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated',
   'authenticated', 'user_b@isolation.test', '', now(), now(), now());

-- Drop into the RLS-governed role for everything below. The output-capture table is created
-- AFTER the switch so `authenticated` owns it — created before, it would need an explicit
-- GRANT to be writable from that role.
set local role authenticated;

create temporary table tap_out (id serial primary key, line text);

-- Seed one source + flashcard + storage object per user, acting AS that user, so the INSERTs
-- themselves pass through RLS/Storage WITH CHECK (proof an owner can write their own rows).
-- `learned_language`/`known_language` are NOT NULL and `image_path` is required for the default
-- `type = 'screenshot'` (sources_screenshot_requires_image) — current schema, not F-01's original.
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

insert into public.sources (id, user_id, image_path, learned_language, known_language)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111/shot.png', 'it', 'pl');
insert into public.flashcards (id, user_id, source_id, front, back)
values ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001', 'ciao', 'cześć');
insert into storage.objects (bucket_id, name, owner)
values ('screenshots', '11111111-1111-1111-1111-111111111111/shot.png', '11111111-1111-1111-1111-111111111111');

select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

insert into public.sources (id, user_id, image_path, learned_language, known_language)
values ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
        '22222222-2222-2222-2222-222222222222/shot.png', 'it', 'pl');
insert into public.flashcards (id, user_id, source_id, front, back)
values ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
        'bbbbbbbb-0000-0000-0000-000000000001', 'ciao', 'cześć');
insert into storage.objects (bucket_id, name, owner)
values ('screenshots', '22222222-2222-2222-2222-222222222222/shot.png', '22222222-2222-2222-2222-222222222222');

-- ---------------------------------------------------------------------------------------
-- Table RLS: acting as user B, try to reach user A's sources/flashcards every way (claims
-- are already user B from the seed step above).
-- ---------------------------------------------------------------------------------------

insert into tap_out (line) select results_eq(
  $$ select count(*)::int from public.sources where user_id = '11111111-1111-1111-1111-111111111111' $$,
  ARRAY[0],
  'user B cannot SELECT user A''s sources'
);

insert into tap_out (line) select results_eq(
  $$ select count(*)::int from public.flashcards where user_id = '11111111-1111-1111-1111-111111111111' $$,
  ARRAY[0],
  'user B cannot SELECT user A''s flashcards'
);

insert into tap_out (line) select results_eq(
  $$ select count(*)::int from public.sources $$,
  ARRAY[1],
  'user B sees exactly their own source (RLS is not blocking everything)'
);

insert into tap_out (line) select throws_ok(
  $$ insert into public.sources (user_id, image_path, learned_language, known_language)
     values ('11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111/evil.png', 'it', 'pl') $$,
  '42501',
  NULL,
  'user B cannot INSERT a source owned by A (WITH CHECK not enforced)'
);

insert into tap_out (line) select results_eq(
  $$ with updated as (
       update public.sources set user_id = user_id
       where user_id = '11111111-1111-1111-1111-111111111111'
       returning 1
     )
     select count(*)::int from updated $$,
  ARRAY[0],
  'user B UPDATE of user A''s sources affects 0 rows'
);

insert into tap_out (line) select results_eq(
  $$ with deleted as (
       delete from public.sources
       where user_id = '11111111-1111-1111-1111-111111111111'
       returning 1
     )
     select count(*)::int from deleted $$,
  ARRAY[0],
  'user B DELETE of user A''s sources affects 0 rows'
);

-- ---------------------------------------------------------------------------------------
-- Table RLS: acting as user A again, confirm nothing above touched their row, then perform
-- a real (legitimate) delete of their own source and confirm the flashcard cascade (FR-006).
-- ---------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

insert into tap_out (line) select results_eq(
  $$ select count(*)::int from public.sources $$,
  ARRAY[1],
  'user A still sees exactly their own (untouched) source after user B''s attempts'
);

insert into tap_out (line) select lives_ok(
  $$ delete from public.sources where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'user A can delete their own source'
);

insert into tap_out (line) select results_eq(
  $$ select count(*)::int from public.flashcards where source_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  ARRAY[0],
  'deleting a source cascades to its flashcards (FR-006)'
);

-- ---------------------------------------------------------------------------------------
-- Storage RLS: acting as user B, try to reach user A's screenshot object. The source-row
-- delete above does not touch storage.objects (no DB-level FK), so user A's object is still
-- the right fixture to attack here. DELETE is intentionally not tested — see header comment.
-- ---------------------------------------------------------------------------------------

select set_config('request.jwt.claims',
  json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

insert into tap_out (line) select results_eq(
  $$ select count(*)::int from storage.objects
     where bucket_id = 'screenshots' and name = '11111111-1111-1111-1111-111111111111/shot.png' $$,
  ARRAY[0],
  'user B cannot SELECT user A''s screenshot object'
);

insert into tap_out (line) select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('screenshots', '11111111-1111-1111-1111-111111111111/evil.png', '22222222-2222-2222-2222-222222222222') $$,
  '42501',
  NULL,
  'user B cannot INSERT into user A''s storage folder (WITH CHECK not enforced)'
);

insert into tap_out (line) select results_eq(
  $$ with updated as (
       update storage.objects set owner = '22222222-2222-2222-2222-222222222222'
       where bucket_id = 'screenshots' and name = '11111111-1111-1111-1111-111111111111/shot.png'
       returning 1
     )
     select count(*)::int from updated $$,
  ARRAY[0],
  'user B UPDATE of user A''s screenshot object affects 0 rows'
);

-- Sanity: acting as user A, their screenshot object survived every attempt above.
select set_config('request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

insert into tap_out (line) select results_eq(
  $$ select count(*)::int from storage.objects
     where bucket_id = 'screenshots' and name = '11111111-1111-1111-1111-111111111111/shot.png' $$,
  ARRAY[1],
  'user A''s screenshot object is untouched after user B''s attempts'
);

insert into tap_out (line) select * from finish();

select line from tap_out order by id;

rollback;
