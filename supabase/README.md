# Supabase — database workflow

The Anki-enabler data/auth/storage layer lives entirely in Supabase (the single source of
truth — see `context/foundation/infrastructure.md`). Development uses a **hosted cloud
project**; there is no local Supabase stack.

## Migrations

Migrations live in `supabase/migrations/` and are **forward-only / additive** — a Vercel code
rollback does not revert an applied migration, so migrations never assume a down path. Add new
columns/tables in a *new* migration rather than editing an existing one.

Apply migrations to the linked project:

```bash
supabase link --project-ref <your-project-ref>   # one-time, needs `supabase login`
supabase db push
```

## TypeScript types — regenerate after every migration

The typed schema is committed at `src/db/database.types.ts`. **Regenerate it after every
migration** so queries stay type-safe:

```bash
supabase gen types typescript --linked > src/db/database.types.ts
```

Do not hand-edit `database.types.ts` — it is generated output.

## Per-user isolation (critical)

Row-Level Security (RLS) is the *only* thing isolating one user's data from another's. Two
requirements keep it intact:

- **`SUPABASE_KEY` must be the anon/publishable key**, never the `service_role` key —
  service_role bypasses RLS entirely (see `src/lib/supabase.ts`).
- Every new user-owned table must `enable row level security` and carry an owner policy
  checking `auth.uid() = user_id` in both `using` and `with check`.

After any schema or RLS change, re-run the isolation check to confirm no cross-user access
path exists:

```bash
npx supabase db query --file supabase/tests/isolation.sql --linked
```

A clean (non-error) run means isolation holds; any raised exception names the breach.
