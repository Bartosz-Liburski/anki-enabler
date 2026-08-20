import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isSupportedLanguage } from "@/lib/languages";
import { MAX_UPLOAD_BYTES, extensionForImageType, isAcceptedImageType } from "@/lib/upload-limits";
import { SOURCE_SUCCESS_CODE, type SourceErrorCode } from "@/lib/source-errors";
import { dashboardUrl, sourceUrl } from "@/lib/source-pair";

const BUCKET = "screenshots";

/**
 * Create a screenshot source: validate, store the image, record the row (S-01).
 *
 * `/api/*` is not covered by the middleware's route guard, so the auth check happens here.
 * Validation runs to completion *before* any upload or insert, so an oversized or wrong-format
 * file never reaches Storage. The object is written to `{user_id}/...` — the `screenshots`
 * Storage policies key on that first path segment, so the convention is load-bearing for
 * per-user isolation, not cosmetic.
 *
 * Every redirect carries the language pair back to the dashboard so the chosen pair survives
 * the round trip and the next screenshot can be added without picking it again. The languages
 * are therefore validated first — a redirect cannot echo a pair that isn't trustworthy.
 */
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  const user = context.locals.user;
  if (!supabase || !user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const file = form.get("file");
  const learnedLanguage = form.get("learned_language");
  const knownLanguage = form.get("known_language");

  if (
    typeof learnedLanguage !== "string" ||
    typeof knownLanguage !== "string" ||
    !isSupportedLanguage(learnedLanguage) ||
    !isSupportedLanguage(knownLanguage)
  ) {
    return context.redirect(dashboardUrl({ error: "language-invalid" }));
  }
  if (learnedLanguage === knownLanguage) {
    return context.redirect(dashboardUrl({ error: "language-same" }));
  }

  const pair = { learned_language: learnedLanguage, known_language: knownLanguage };
  const fail = (code: SourceErrorCode) => context.redirect(dashboardUrl({ ...pair, error: code }));

  if (!(file instanceof File) || file.size === 0) {
    return fail("file-missing");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return fail("file-too-large");
  }
  if (!isAcceptedImageType(file.type)) {
    return fail("file-type");
  }

  // Generate the id up front so the object path and the row's primary key match.
  const id = crypto.randomUUID();
  const imagePath = `${user.id}/${id}.${extensionForImageType(file.type)}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(imagePath, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) {
    return fail("upload-failed");
  }

  const { error: insertError } = await supabase.from("sources").insert({
    id,
    user_id: user.id,
    type: "screenshot",
    image_path: imagePath,
    learned_language: learnedLanguage,
    known_language: knownLanguage,
  });
  if (insertError) {
    // Best effort: drop the just-uploaded object so a failed create leaves no orphan.
    await supabase.storage.from(BUCKET).remove([imagePath]);
    return fail("save-failed");
  }

  // Land on the new source rather than the dashboard (S-02): browse is S-04's, so this redirect is
  // the only path from the UI to a saved source, and without it generation would be unreachable.
  // The language pair stays on the dashboard's own redirects — the review screen links back to the
  // dashboard carrying it, so S-01's "add another screenshot to this pair" loop still holds.
  return context.redirect(sourceUrl(id, { success: SOURCE_SUCCESS_CODE }));
};
