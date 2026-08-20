import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { CARDS_SAVED_CODE, type SourceErrorCode } from "@/lib/source-errors";
import { dashboardUrl, sourceUrl } from "@/lib/source-pair";

/**
 * Persist the whole card set's keep/discard decisions in one call (S-02, FR-010).
 *
 * **"Not in the list" is the only way a discard can be expressed.** An unchecked checkbox submits
 * nothing, so the request carries the kept ids and says nothing at all about the discarded ones.
 * This endpoint therefore rewrites the flag for *every* card of the source — listed ids become
 * `discarded = false`, everything else `true`. Updating only the listed ids would make discarding
 * silently impossible.
 *
 * The source's own card ids are read first and the submitted ids intersected against them, rather
 * than trusting the form. That does two jobs: a forged id belonging to another source (or another
 * user) simply falls out of the set, and the two updates can use parameter arrays instead of an
 * interpolated PostgREST filter string. Ownership still rests on RLS — this is scoping, not the
 * security boundary.
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

  const form = await context.request.formData();
  const submitted = new Set(form.getAll("keep").filter((value): value is string => typeof value === "string"));

  const { data: cards, error: readError } = await supabase.from("flashcards").select("id").eq("source_id", id);
  if (readError) {
    return fail("review-save-failed");
  }

  const ownIds = cards.map((card) => card.id);
  const toKeep = ownIds.filter((cardId) => submitted.has(cardId));
  const toDiscard = ownIds.filter((cardId) => !submitted.has(cardId));

  if (toDiscard.length > 0) {
    const { error } = await supabase
      .from("flashcards")
      .update({ discarded: true })
      .eq("source_id", id)
      .in("id", toDiscard);
    if (error) {
      return fail("review-save-failed");
    }
  }

  if (toKeep.length > 0) {
    const { error } = await supabase
      .from("flashcards")
      .update({ discarded: false })
      .eq("source_id", id)
      .in("id", toKeep);
    if (error) {
      return fail("review-save-failed");
    }
  }

  return context.redirect(sourceUrl(id, { success: CARDS_SAVED_CODE }));
};
