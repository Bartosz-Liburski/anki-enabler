-- Isolation test: per-user RLS on sources & flashcards (F-01)
--
-- Proves the launch-gating NFR: "a user's sources and generated flashcards are never
-- visible to any other user." Seeds two users, then — acting AS each user via a JWT claim —
-- asserts that no read/insert/update/delete path crosses the user boundary.
--
-- HOW TO RUN (against the linked hosted project, via the Management API):
--   npx supabase db query --file supabase/tests/isolation.sql --linked
--
-- The whole test is ONE `DO` block (a single statement) so it runs in one transaction with
-- one session context — no psql meta-commands, no cross-statement role state. It runs as the
-- privileged Management-API role, then `set local role authenticated` drops into the role
-- RLS actually applies to (auth.uid() reads request.jwt.claims->>'sub'), exactly like the
-- app's per-request client.
--
-- Outcome:
--   * All assertions pass  -> block completes, fixtures are deleted, returns no error.
--   * Any breach           -> `raise exception` aborts the block; the whole statement's
--                             transaction rolls back, so fixture rows never persist.
-- So a clean (non-error) run == isolation holds; an error == a real isolation failure
-- (or a setup problem, which the message will name).
--
-- NOTE: auth.users' required columns vary by Supabase version. If the fixture insert fails
-- on a NOT NULL column, add it to the insert below — the isolation logic is unaffected.

do $$
declare
  user_a constant uuid := '11111111-1111-1111-1111-111111111111';
  user_b constant uuid := '22222222-2222-2222-2222-222222222222';
  src_a  constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  fc_a   constant uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  src_b  constant uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  fc_b   constant uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  n              int;
  affected       int;
  insert_blocked boolean := false;
begin
  -- --- Fixtures (as the privileged role; bypasses RLS) ---------------------
  delete from auth.users where id in (user_a, user_b);  -- idempotent clean slate
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', user_a, 'authenticated', 'authenticated',
     'user_a@isolation.test', '', now(), now(), now()),
    ('00000000-0000-0000-0000-000000000000', user_b, 'authenticated', 'authenticated',
     'user_b@isolation.test', '', now(), now(), now());

  -- --- Drop into the RLS-governed role ------------------------------------
  set local role authenticated;

  -- Seed one source + flashcard for each user, acting as that user, so the INSERTs
  -- themselves pass through RLS WITH CHECK (proof that an owner can write their own rows).
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text, true);
  insert into public.sources (id, user_id) values (src_a, user_a);
  insert into public.flashcards (id, user_id, source_id) values (fc_a, user_a, src_a);

  perform set_config('request.jwt.claims',
    json_build_object('sub', user_b::text, 'role', 'authenticated')::text, true);
  insert into public.sources (id, user_id) values (src_b, user_b);
  insert into public.flashcards (id, user_id, source_id) values (fc_b, user_b, src_b);

  -- --- Assertions: acting as user B, try to reach user A's data every way --
  -- (claims are currently user B)

  -- 1. SELECT must not reveal user A's rows.
  select count(*) into n from public.sources where user_id = user_a;
  if n <> 0 then raise exception 'ISOLATION FAILURE: user B can SELECT % of A''s sources', n; end if;

  select count(*) into n from public.flashcards where user_id = user_a;
  if n <> 0 then raise exception 'ISOLATION FAILURE: user B can SELECT % of A''s flashcards', n; end if;

  -- 2. Sanity: user B sees exactly their own row (RLS is not blocking everything).
  select count(*) into n from public.sources;
  if n <> 1 then raise exception 'ISOLATION FAILURE: user B sees % sources, expected exactly 1', n; end if;

  -- 3. INSERT carrying user A's user_id must be rejected by WITH CHECK.
  begin
    insert into public.sources (user_id) values (user_a);
  exception when others then
    insert_blocked := true;
  end;
  if not insert_blocked then
    raise exception 'ISOLATION FAILURE: user B inserted a source owned by A (WITH CHECK not enforced)';
  end if;

  -- 4. UPDATE of user A's rows must affect zero rows.
  update public.sources set user_id = user_id where user_id = user_a;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ISOLATION FAILURE: user B UPDATEd % of A''s sources', affected; end if;

  -- 5. DELETE of user A's rows must affect zero rows.
  delete from public.sources where user_id = user_a;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'ISOLATION FAILURE: user B DELETEd % of A''s sources', affected; end if;

  -- 6. Acting as user A, confirm A still sees exactly their own (untouched) row.
  perform set_config('request.jwt.claims',
    json_build_object('sub', user_a::text, 'role', 'authenticated')::text, true);
  select count(*) into n from public.sources;
  if n <> 1 then raise exception 'ISOLATION FAILURE: user A sees % sources, expected exactly 1', n; end if;

  -- 7. Cascade (FR-006): deleting user A's source removes its flashcards.
  delete from public.sources where id = src_a;
  select count(*) into n from public.flashcards where source_id = src_a;
  if n <> 0 then raise exception 'CASCADE FAILURE: % flashcards survived deletion of their source', n; end if;

  -- --- Cleanup (back to privileged role) ----------------------------------
  reset role;
  delete from auth.users where id in (user_a, user_b);  -- cascades to sources + flashcards

  raise notice 'ISOLATION OK: no cross-user read/insert/update/delete path; each user sees only their own rows';
end
$$;
