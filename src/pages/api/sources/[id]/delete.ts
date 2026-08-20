import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { SOURCE_DELETED_CODE, type SourceErrorCode } from "@/lib/source-errors";
import { dashboardUrl, sourceUrl } from "@/lib/source-pair";

const BUCKET = "screenshots";

/**
 * Delete one source, its flashcards, and its stored screenshot (S-04, FR-006).
 *
 * **The cards are not deleted here.** `flashcards.source_id` is declared `ON DELETE CASCADE`
 * (20260723162258_init_sources_flashcards.sql:49), so removing the source row removes them — FR-006
 * is a schema guarantee, and deleting them explicitly first would be redundant work that could also
 * half-succeed.
 *
 * **The delete order is load-bearing, and the safe order is the counter-intuitive one.** The row
 * goes first and the Storage object second, best-effort. Removing the object first would mean a
 * failure between the two steps leaves a source row pointing at an image that no longer exists —
 * a state `sources_screenshot_requires_image` cannot catch, because it only requires `image_path`
 * to be non-null, not that the object behind it survives. Generation on such a source fails with
 * `source-image-missing` and the user has a broken deck they cannot repair. Row-first inverts that
 * failure into an orphaned object: invisible, costing quota, but harmless to every user-facing
 * flow. The same best-effort shape the create path already uses (sources.ts:80-84).
 *
 * Deletion is irreversible: no soft-delete, no trash, no undo.
 */
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  const user = context.locals.user;
  // `/api/*` is not covered by the middleware's route guard, so the auth check happens here.
  if (!supabase || !user) {
    return context.redirect("/auth/signin");
  }

  const id = context.params.id;
  if (!id) {
    return context.redirect(dashboardUrl({ error: "source-not-found" }));
  }

  const fail = (code: SourceErrorCode) => context.redirect(sourceUrl(id, { error: code }));

  // Confirmation is checked BEFORE anything is read or destroyed. The island always sends this
  // field; the guard exists so a page that never hydrated — or a hand-rolled POST — cannot delete.
  const form = await context.request.formData();
  if (form.get("confirm") !== "delete") {
    return fail("delete-confirm-required");
  }

  // Read the object path before the row goes: afterwards it is unrecoverable, and the orphan would
  // be undetectable. RLS scopes this to the owner, so a missing row covers both "no such source"
  // and "someone else's" — deliberately indistinguishable, per source-errors.ts:42-44.
  const { data: source, error: readError } = await supabase
    .from("sources")
    .select("image_path")
    .eq("id", id)
    .maybeSingle();

  if (readError) {
    return fail("delete-failed");
  }
  if (!source) {
    return context.redirect(dashboardUrl({ error: "source-not-found" }));
  }

  const { error: deleteError } = await supabase.from("sources").delete().eq("id", id);
  if (deleteError) {
    return fail("delete-failed");
  }

  // Best-effort by design: the result is deliberately not checked, because the user's deletion has
  // already succeeded and a failure here must not report it as failed. See the header note.
  if (source.image_path) {
    await supabase.storage.from(BUCKET).remove([source.image_path]);
  }

  // Back to the dashboard rather than the source page — that page no longer exists. The middleware's
  // pair recall re-attaches the language pair and carries the success param (source-pair.ts:81-84).
  return context.redirect(dashboardUrl({ success: SOURCE_DELETED_CODE }));
};
