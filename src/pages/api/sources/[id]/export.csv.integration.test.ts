import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestUsers, teardownTestUsers, type TestUser } from "@/test/supabase-test-users";
import { createClient } from "@/lib/supabase";
import { GET } from "./export.csv";

let userA: TestUser;
let userB: TestUser;
let sourceId: string;

function requireClient(user: TestUser) {
  const client = createClient(user.request.headers, user.cookies);
  if (!client) throw new Error("createClient() returned null — check SUPABASE_URL/SUPABASE_KEY");
  return client;
}

beforeAll(async () => {
  ({ userA, userB } = await setupTestUsers());
  const supabaseA = requireClient(userA);

  const { data: source, error: sourceError } = await supabaseA
    .from("sources")
    .insert({
      user_id: userA.id,
      image_path: `${userA.id}/shot.png`,
      learned_language: "it",
      known_language: "pl",
    })
    .select("id")
    .single();
  if (sourceError) throw new Error(`fixture: failed to seed source: ${sourceError.message}`);
  sourceId = source.id;

  const { error: cardError } = await supabaseA
    .from("flashcards")
    .insert({ user_id: userA.id, source_id: sourceId, front: "ciao", back: "cześć", discarded: false });
  if (cardError) throw new Error(`fixture: failed to seed flashcard: ${cardError.message}`);
});

afterAll(async () => {
  await teardownTestUsers(userA, userB);
});

describe("GET /api/sources/[id]/export.csv — IDOR", () => {
  it("user B cannot download user A's kept cards via a known source id", async () => {
    const context = {
      request: userB.request,
      cookies: userB.cookies,
      locals: { user: { id: userB.id } },
      redirect: (url: string) => new Response(null, { status: 302, headers: { Location: url } }),
      params: { id: sourceId },
    } as unknown as Parameters<typeof GET>[0];

    const response = await GET(context);
    // A real export would be a 200 with a CSV body — this must be a redirect instead, and
    // specifically the "not found" outcome, never a response that echoes user A's card text.
    expect(response.status).not.toBe(200);
    expect(response.headers.get("Location")).toContain("error=source-not-found");
  });
});
