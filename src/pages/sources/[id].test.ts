import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import reactServerRenderer from "@astrojs/react/server.js";
import { setupTestUsers, teardownTestUsers, type TestUser } from "@/test/supabase-test-users";
import { createClient } from "@/lib/supabase";
import SourcePage from "./[id].astro";

let userA: TestUser;
let userB: TestUser;
let sourceId: string;
let cardFront: string;

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

  cardFront = "ciao-idor-canary";
  const { error: cardError } = await supabaseA
    .from("flashcards")
    .insert({ user_id: userA.id, source_id: sourceId, front: cardFront, back: "cześć", discarded: false });
  if (cardError) throw new Error(`fixture: failed to seed flashcard: ${cardError.message}`);
});

afterAll(async () => {
  await teardownTestUsers(userA, userB);
});

describe("GET /sources/[id] — IDOR", () => {
  it("user B visiting user A's source id sees 'not found', never A's card content", async () => {
    // Container API renders the page as a real request would. Only a SERVER renderer is
    // registered — the `source === null` branch (the one this attack reaches) never hydrates
    // the page's client:load islands (ReviewCardList, RegenerateForm, DeleteSourceForm), so no
    // client renderer is needed.
    const container = await AstroContainer.create();
    container.addServerRenderer({ renderer: reactServerRenderer });

    // experimental_AstroContainer's signature doesn't resolve a `.astro` import's type under
    // typescript-eslint's project service; `astro check` (Astro's own type-checker) confirms
    // this call is valid.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const html = await container.renderToString(SourcePage, {
      params: { id: sourceId },
      request: new Request(`http://localhost/sources/${sourceId}`, { headers: { Cookie: userB.cookieHeader } }),
    });

    expect(html).toContain("Source not found");
    expect(html).not.toContain(cardFront);
  });
});
