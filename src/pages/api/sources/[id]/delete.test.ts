import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ createClient: () => ({}) }));

import { POST } from "./delete";

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

describe("POST /api/sources/[id]/delete — malformed request body", () => {
  it("redirects with request-invalid instead of throwing", async () => {
    const response = await POST(mockContext());
    expect(response.headers.get("Location")).toContain("error=request-invalid");
  });
});
