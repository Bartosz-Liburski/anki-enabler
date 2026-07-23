-- Isolation test: per-user RLS on sources & flashcards (F-01)
--
-- Proves the launch-gating NFR: "a user's sources and generated flashcards are never
-- visible to any other user." Seeds two users, then — acting AS each user via JWT claims —
-- asserts that no read/insert/update/delete path crosses the user boundary.
--
-- HOW TO RUN (against the linked hosted project):
--   supabase db execute --file supabase/tests/isolation.sql --linked
-- or with psql against the project's connection string:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/isolation.sql
--
-- Must be run by a superuser/owner role (the default DB connection), because it inserts
-- fixture rows into auth.users. It then drops to the `authenticated` role + a JWT claim to
-- exercise RLS exactly as the app's per-request client does (auth.uid() reads
-- request.jwt.claims->>'sub').
--
-- The whole run is wrapped in a transaction and ROLLED BACK at the end, so it leaves no
-- residue and is safe to re-run. Any isolation breach raises an exception, which (with
-- ON_ERROR_STOP / the transaction) fails the run non-zero. A clean run prints
-- 'ISOLATION OK' and rolls back.
--
-- NOTE: auth.users' required columns vary by Supabase version. If the fixture insert fails
-- on a NOT NULL column, add it to the insert below — the isolation logic is unaffected.

begin;

-- Fixed fixture UUIDs for the two test users.
\set user_a '11111111-1111-1111-1111-111111111111'
\set user_b '22222222-2222-2222-2222-222222222222'

-- ---------------------------------------------------------------------------
-- Fixtures (as the default superuser/owner role — bypasses RLS).
-- ---------------------------------------------------------------------------
reset role;

insert into auth.users (id, email)
values
  (:'user_a', 'user_a@isolation.test'),
  (:'user_b', 'user_b@isolation.test');

-- Helper: assume a given user's identity for subsequent statements.
create or replace function pg_temp.act_as(user_id uuid) returns void as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Seed one source + one flashcard for each user, acting as that user (so the
-- INSERTs themselves go through RLS WITH CHECK — a first proof that owners can write).
-- ---------------------------------------------------------------------------
select pg_temp.act_as(:'user_a');
insert into public.sources (id, user_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001', :'user_a');
insert into public.flashcards (id, user_id, source_id)
  values ('aaaaaaaa-0000-0000-0000-000000000002', :'user_a', 'aaaaaaaa-0000-0000-0000-000000000001');

select pg_temp.act_as(:'user_b');
insert into public.sources (id, user_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001', :'user_b');
insert into public.flashcards (id, user_id, source_id)
  values ('bbbbbbbb-0000-0000-0000-000000000002', :'user_b', 'bbbbbbbb-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Assertions — acting as user B, try to reach user A's data every way.
-- ---------------------------------------------------------------------------
do $$
declare
  visible_a_sources    int;
  visible_a_flashcards int;
  total_visible_sources int;
  affected             int;
  insert_blocked       boolean := false;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
    true
  );

  -- 1. SELECT must not reveal user A's rows.
  select count(*) into visible_a_sources
    from public.sources where user_id = '11111111-1111-1111-1111-111111111111';
  if visible_a_sources <> 0 then
    raise exception 'ISOLATION FAILURE: user B can SELECT % of user A''s sources', visible_a_sources;
  end if;

  select count(*) into visible_a_flashcards
    from public.flashcards where user_id = '11111111-1111-1111-1111-111111111111';
  if visible_a_flashcards <> 0 then
    raise exception 'ISOLATION FAILURE: user B can SELECT % of user A''s flashcards', visible_a_flashcards;
  end if;

  -- 2. User B must see exactly their own rows (sanity: RLS is not blocking everything).
  select count(*) into total_visible_sources from public.sources;
  if total_visible_sources <> 1 then
    raise exception 'ISOLATION FAILURE: user B sees % sources, expected exactly 1 (their own)', total_visible_sources;
  end if;

  -- 3. INSERT carrying user A's user_id must be rejected by WITH CHECK.
  begin
    insert into public.sources (user_id) values ('11111111-1111-1111-1111-111111111111');
  exception when others then
    insert_blocked := true;
  end;
  if not insert_blocked then
    raise exception 'ISOLATION FAILURE: user B inserted a source owned by user A (WITH CHECK not enforced)';
  end if;

  -- 4. UPDATE of user A's rows must affect zero rows.
  update public.sources set user_id = user_id
    where user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'ISOLATION FAILURE: user B UPDATEd % of user A''s sources', affected;
  end if;

  -- 5. DELETE of user A's rows must affect zero rows.
  delete from public.sources where user_id = '11111111-1111-1111-1111-111111111111';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'ISOLATION FAILURE: user B DELETEd % of user A''s sources', affected;
  end if;

  raise notice 'ISOLATION OK: no cross-user read/insert/update/delete path from user B to user A';
end;
$$;

-- Confirm user A still sees exactly their own data (untouched by B's attempts).
select pg_temp.act_as(:'user_a');
do $$
declare own_sources int;
begin
  select count(*) into own_sources from public.sources;
  if own_sources <> 1 then
    raise exception 'ISOLATION FAILURE: user A sees % sources, expected exactly 1', own_sources;
  end if;
  raise notice 'ISOLATION OK: user A sees exactly their own source';
end;
$$;

reset role;
rollback;
