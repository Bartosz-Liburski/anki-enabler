import { createClient as createSupabaseAdminClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import type { Database } from "@/db/database.types";

/**
 * Seeds two real, signed-in Supabase users against the hosted-linked project for integration
 * tests (Phase 3/4 of this rollout). Every consumer builds a real per-request Supabase client the
 * same way a live request does — `createClient(request.headers, cookies)` from `@/lib/supabase` —
 * so these tests exercise the actual RLS-authenticated call path, not a mocked one.
 *
 * Requires `SUPABASE_URL`, `SUPABASE_KEY` (anon), and `SUPABASE_SERVICE_ROLE_KEY` (test-only, see
 * `.env.example`) to be set. The service-role key is used here — and only here — to create/delete
 * test users via the Admin API; app code must never use it (see `src/lib/supabase.ts`).
 */

export interface TestUser {
  id: string;
  email: string;
  /** Carries the signed-in session as a `Cookie` header, exactly like a real browser request. */
  request: Request;
  /** Minimal `AstroCookies`-compatible stub — satisfies `createClient()`'s `.set()` usage for a
   * possible token-refresh write; other members are unused by the routes under test. */
  cookies: AstroCookies;
  /** The raw `Cookie` header value — lets a test build its own `Request` (e.g. with a form-data
   * body for a POST route) while still carrying this user's real session. */
  cookieHeader: string;
}

function requireEnv() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error(
      "supabase-test-users: SUPABASE_URL, SUPABASE_KEY, and SUPABASE_SERVICE_ROLE_KEY must all be set " +
        "(see .env.example) to run integration tests against the hosted project.",
    );
  }
  return { url, anonKey, serviceRoleKey };
}

function cookieJarStub(captured: Map<string, string>): AstroCookies {
  const jar = {
    get: (name: string) => {
      const value = captured.get(name);
      return value === undefined ? undefined : { name, value };
    },
    has: (name: string) => captured.has(name),
    set: (name: string, value: string) => {
      captured.set(name, value);
    },
    delete: (name: string) => {
      captured.delete(name);
    },
  };
  // AstroCookies carries more members (headers(), merge(), etc.) that none of the routes under
  // test call — casting rather than implementing the full interface for a test-only stub.
  return jar as unknown as AstroCookies;
}

async function createSignedInUser(label: "a" | "b"): Promise<TestUser> {
  const { url, anonKey, serviceRoleKey } = requireEnv();
  const admin = createSupabaseAdminClient<Database>(url, serviceRoleKey);

  const email = `test-user-${label}-${crypto.randomUUID()}@isolation.test`;
  const password = crypto.randomUUID();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) {
    throw new Error(`supabase-test-users: failed to create test user ${label}: ${createError.message}`);
  }
  const userId = created.user.id;

  try {
    // Sign in through a real server client so the session cookies come out exactly as
    // @supabase/ssr would chunk/serialize them for a live request — capture-then-replay, rather
    // than hand-rolling the cookie format ourselves.
    const captured = new Map<string, string>();
    const signInClient = createServerClient<Database>(url, anonKey, {
      cookies: {
        getAll: () => [],
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => {
            captured.set(name, value);
          });
        },
      },
    });
    const { error: signInError } = await signInClient.auth.signInWithPassword({ email, password });
    if (signInError) {
      throw new Error(`supabase-test-users: failed to sign in test user ${label}: ${signInError.message}`);
    }

    const cookieHeader = [...captured.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    const request = new Request("http://localhost/", { headers: { Cookie: cookieHeader } });

    return { id: userId, email, request, cookies: cookieJarStub(captured), cookieHeader };
  } catch (error) {
    // The user was created but never fully set up — delete it now rather than leaking a real
    // row in the hosted project's auth.users that nothing would otherwise clean up.
    await admin.auth.admin.deleteUser(userId);
    throw error;
  }
}

export async function setupTestUsers(): Promise<{ userA: TestUser; userB: TestUser }> {
  const results = await Promise.allSettled([createSignedInUser("a"), createSignedInUser("b")]);
  const succeeded = results.filter(
    (result): result is PromiseFulfilledResult<TestUser> => result.status === "fulfilled",
  );
  const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

  if (failed.length > 0) {
    // At least one user's own setup failed — any user that DID succeed would otherwise leak,
    // since this function is about to throw and its caller never receives a TestUser to tear
    // down for it.
    await teardownTestUsers(...succeeded.map((result) => result.value));
    throw new Error(
      `supabase-test-users: setupTestUsers failed: ${failed.map((result) => (result.reason as Error).message).join("; ")}`,
    );
  }

  const [userA, userB] = succeeded.map((result) => result.value);
  return { userA, userB };
}

/** Deletes the given test users; `ON DELETE CASCADE` takes their sources/flashcards with them. */
export async function teardownTestUsers(...users: TestUser[]): Promise<void> {
  const { url, serviceRoleKey } = requireEnv();
  const admin = createSupabaseAdminClient<Database>(url, serviceRoleKey);
  const results = await Promise.allSettled(users.map((user) => admin.auth.admin.deleteUser(user.id)));

  const failures = results
    .map((result, index) => ({ result, user: users[index] }))
    .filter((entry): entry is { result: PromiseRejectedResult; user: TestUser } => entry.result.status === "rejected");
  if (failures.length > 0) {
    throw new Error(
      `supabase-test-users: failed to delete user(s): ${failures
        .map(({ user, result }) => `${user.id} (${(result.reason as Error).message})`)
        .join("; ")}`,
    );
  }
}
