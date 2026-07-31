import type { APIRoute } from "astro";
import { ANTHROPIC_API_KEY } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { generateCards, GenerationError } from "@/lib/llm/generate-cards";
import { imageTypeForPath } from "@/lib/upload-limits";
import { CARDS_GENERATED_CODE, CARDS_NONE_CODE, generationErrorCode, type SourceErrorCode } from "@/lib/source-errors";
import { dashboardUrl, sourceUrl } from "@/lib/source-pair";

const BUCKET = "screenshots";

/**
 * Production generation configuration, decided by the Phase 3 eval sweep.
 *
 * All three Sonnet 5 effort levels scored 100% keep-rate with perfect count accuracy on the
 * labelled fixtures, so `high` buys nothing measurable; `low` was not chosen because that fixture
 * set is homogeneous and cannot rule out under-thinking on denser sources. See
 * context/changes/generate-and-review-cards/eval/RESULTS.md. `npm run eval` re-runs the sweep.
 */
const MODEL = "claude-sonnet-5";
const EFFORT = "medium";

/**
 * Turn one stored screenshot source into a fresh flashcard set for the current user (S-02).
 *
 * Synchronous by design: one click is one model call, so there is no job queue and no polling.
 * `maxDuration: 60` in astro.config.mjs covers it — a typical one-card generation lands in
 * single-digit seconds.
 *
 * **Two orderings here are load-bearing, not stylistic:**
 *
 * 1. **Generate before deleting.** Re-generation replaces the set, but if the delete ran first and
 *    the model call then failed, the user would lose their previous cards *and* the review work
 *    they had done on them, with nothing to show for it. The model is called first; the old rows
 *    only go once a valid replacement is in hand.
 * 2. **Write the cards before stamping the source.** Delete + insert land before
 *    `last_generated_at` is set, so a failure can never leave the source claiming a generation
 *    that was never written.
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

  // RLS scopes this to the owner, so a missing row covers both "no such source" and "someone
  // else's source" — and the two are deliberately not distinguished, here or in the message.
  const { data: source } = await supabase
    .from("sources")
    .select("id, image_path, learned_language, known_language")
    .eq("id", id)
    .maybeSingle();

  if (!source) {
    return context.redirect(dashboardUrl({ error: "source-not-found" }));
  }

  const imagePath = source.image_path;
  const mediaType = imagePath ? imageTypeForPath(imagePath) : null;
  if (!imagePath || !mediaType) {
    return fail("source-image-missing");
  }

  if (!ANTHROPIC_API_KEY) {
    return fail("generation-unconfigured");
  }

  // Confirmation is checked BEFORE the model call: a user who lands here by accident on a source
  // that already has cards must not be billed for a generation they never asked for.
  const form = await context.request.formData();
  const confirmed = form.get("confirm") === "replace";

  const { count: existingCards, error: countError } = await supabase
    .from("flashcards")
    .select("id", { count: "exact", head: true })
    .eq("source_id", id);

  if (countError) {
    return fail("generation-failed");
  }
  if ((existingCards ?? 0) > 0 && !confirmed) {
    return fail("generation-confirm-required");
  }

  const { data: image, error: downloadError } = await supabase.storage.from(BUCKET).download(imagePath);
  if (downloadError) {
    return fail("source-image-missing");
  }

  let generated;
  try {
    generated = await generateCards({
      apiKey: ANTHROPIC_API_KEY,
      model: MODEL,
      effort: EFFORT,
      imageBase64: Buffer.from(await image.arrayBuffer()).toString("base64"),
      mediaType,
      learnedLanguage: source.learned_language,
      knownLanguage: source.known_language,
    });
  } catch (error) {
    if (error instanceof GenerationError) {
      return fail(generationErrorCode(error.code));
    }
    return fail("generation-failed");
  }

  // Only now that a valid set is in hand does anything get destroyed.
  const { error: deleteError } = await supabase.from("flashcards").delete().eq("source_id", id);
  if (deleteError) {
    return fail("cards-save-failed");
  }

  if (generated.cards.length > 0) {
    const { error: insertError } = await supabase.from("flashcards").insert(
      generated.cards.map((card) => ({
        user_id: user.id,
        source_id: id,
        front: card.front,
        back: card.back,
      })),
    );
    if (insertError) {
      return fail("cards-save-failed");
    }
  }

  const { error: stampError } = await supabase
    .from("sources")
    .update({
      last_generated_at: new Date().toISOString(),
      // The note is the explanatory empty state (FR-008), so it is stored only when there is
      // nothing else to show. Clearing it on a successful run keeps a stale explanation from
      // outliving the generation that produced it.
      generation_note: generated.cards.length > 0 ? null : generated.emptyReason,
      extraction_confidence: generated.extractionConfidence,
    })
    .eq("id", id);

  if (stampError) {
    return fail("cards-save-failed");
  }

  return context.redirect(
    generated.cards.length > 0
      ? sourceUrl(id, { success: CARDS_GENERATED_CODE, count: String(generated.cards.length) })
      : sourceUrl(id, { success: CARDS_NONE_CODE }),
  );
};
