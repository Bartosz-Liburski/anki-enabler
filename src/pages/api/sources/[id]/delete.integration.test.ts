import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestUsers, teardownTestUsers, type TestUser } from "@/test/supabase-test-users";
import { createClient } from "@/lib/supabase";
import { POST } from "./delete";

let userA: TestUser;
let userB: TestUser;
let sourceId: string;

function requireClient(user: TestUser) {
  const client = createClient(user.request.headers, user.cookies);
  if (!client) throw new Error("createClient() returned null — check SUPABASE_URL/SUPABASE_KEY");
  return client;
}

function confirmedDeleteRequest(cookieHeader: string): Request {
  const form = new FormData();
  form.set("confirm", "delete");
  return new Request("http://localhost/", { method: "POST", headers: { Cookie: cookieHeader }, body: form });
}

beforeAll(async () => {
  ({ userA, userB } = await setupTestUsers());

  const { data, error } = await requireClient(userA)
    .from("sources")
    .insert({
      user_id: userA.id,
      image_path: `${userA.id}/shot.png`,
      learned_language: "it",
      known_language: "pl",
    })
    .select("id")
    .single();
  if (error) throw new Error(`fixture: failed to seed source: ${error.message}`);
  sourceId = data.id;
});

afterAll(async () => {
  await teardownTestUsers(userA, userB);
});

describe("POST /api/sources/[id]/delete — IDOR", () => {
  it("user B cannot delete user A's source, even with confirm=delete", async () => {
    const context = {
      request: confirmedDeleteRequest(userB.cookieHeader),
      cookies: userB.cookies,
      locals: { user: { id: userB.id } },
      redirect: (url: string) => new Response(null, { status: 302, headers: { Location: url } }),
      params: { id: sourceId },
    } as unknown as Parameters<typeof POST>[0];

    const response = await POST(context);
    expect(response.headers.get("Location")).toContain("error=source-not-found");

    // User A's source survives the attempted delete.
    const { data: sourceRow } = await requireClient(userA)
      .from("sources")
      .select("id")
      .eq("id", sourceId)
      .maybeSingle();
    expect(sourceRow).not.toBeNull();
  });
});
