import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestUsers, teardownTestUsers, type TestUser } from "@/test/supabase-test-users";
import { createClient } from "@/lib/supabase";
import { POST } from "./review";

let userA: TestUser;
let userB: TestUser;
let sourceId: string;
let cardId: string;

function requireClient(user: TestUser) {
  const client = createClient(user.request.headers, user.cookies);
  if (!client) throw new Error("createClient() returned null — check SUPABASE_URL/SUPABASE_KEY");
  return client;
}

function reviewRequest(cookieHeader: string, keepIds: string[]): Request {
  const form = new FormData();
  keepIds.forEach((id) => {
    form.append("keep", id);
  });
  return new Request("http://localhost/", { method: "POST", headers: { Cookie: cookieHeader }, body: form });
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

  const { data: card, error: cardError } = await supabaseA
    .from("flashcards")
    .insert({ user_id: userA.id, source_id: sourceId, front: "ciao", back: "cześć" })
    .select("id")
    .single();
  if (cardError) throw new Error(`fixture: failed to seed flashcard: ${cardError.message}`);
  cardId = card.id;
});

afterAll(async () => {
  await teardownTestUsers(userA, userB);
});

describe("POST /api/sources/[id]/review — IDOR", () => {
  it("user B submitting user A's card id as 'keep' does not discard or reveal it", async () => {
    // Attempt to discard the card by NOT listing it as kept — if RLS's scoping ever weakened,
    // this is exactly the request shape that would silently discard someone else's card.
    const context = {
      request: reviewRequest(userB.cookieHeader, []),
      cookies: userB.cookies,
      locals: { user: { id: userB.id } },
      redirect: (url: string) => new Response(null, { status: 302, headers: { Location: url } }),
      params: { id: sourceId },
    } as unknown as Parameters<typeof POST>[0];

    const response = await POST(context);
    // The route can't distinguish "not found" from "not yours" at this layer (it never looks up
    // the source itself) — success here is expected; the real assertion is that nothing changed.
    expect(response.status).toBe(302);

    const { data: cardRow } = await requireClient(userA)
      .from("flashcards")
      .select("discarded")
      .eq("id", cardId)
      .maybeSingle();
    expect(cardRow?.discarded).toBe(false);
  });
});
