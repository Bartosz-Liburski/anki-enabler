import { describe, expect, it, vi } from "vitest";

// generate.ts reads ANTHROPIC_API_KEY directly from astro:env/server (not via createClient),
// so it needs its own mock, deterministic regardless of the real .env on the machine running this.
vi.mock("astro:env/server", () => ({ ANTHROPIC_API_KEY: "test-key" }));

// generate.ts queries `sources` for the row BEFORE reaching formData(), so the fake client needs
// a minimal chainable builder resolving to a plausible source row — not just a truthy `{}`.
function fakeQueryBuilder(row: Record<string, unknown>) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: () =>
      fakeQueryBuilder({
        id: "source-1",
        image_path: "user-1/shot.png",
        learned_language: "it",
        known_language: "pl",
      }),
  }),
}));

import { POST } from "./generate";

function mockContext(): Parameters<typeof POST>[0] {
  const request = {
    formData: () => Promise.reject(new Error("malformed multipart body")),
  } as unknown as Request;

  return {
    request,
    cookies: {},
    locals: { user: { id: "user-1" } },
    redirect: (url: string) => new Response(null, { status: 302, headers: { Location: url } }),
    params: { id: "source-1" },
  } as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/sources/[id]/generate — malformed request body", () => {
  it("redirects with request-invalid instead of throwing", async () => {
    const response = await POST(mockContext());
    expect(response.headers.get("Location")).toContain("error=request-invalid");
  });
});
