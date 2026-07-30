import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isSupportedLanguage } from "@/lib/languages";
import { MAX_UPLOAD_BYTES, extensionForImageType, isAcceptedImageType } from "@/lib/upload-limits";

const BUCKET = "screenshots";

/**
 * Error codes surfaced through `?error=` on the dashboard, which owns their messages.
 * Kept short and stable so the redirect URL stays readable.
 */
type SourceErrorCode =
  | "file-missing"
  | "file-too-large"
  | "file-type"
  | "language-invalid"
  | "language-same"
  | "upload-failed"
  | "save-failed";

/**
 * Create a screenshot source: validate, store the image, record the row (S-01).
 *
 * `/api/*` is not covered by the middleware's route guard, so the auth check happens here.
 * Validation runs to completion *before* any upload or insert, so an oversized or wrong-format
 * file never reaches Storage. The object is written to `{user_id}/...` — the `screenshots`
 * Storage policies key on that first path segment, so the convention is load-bearing for
 * per-user isolation, not cosmetic.
 */
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  const user = context.locals.user;
  if (!supabase || !user) {
    return context.redirect("/auth/signin");
  }

  const fail = (code: SourceErrorCode) => context.redirect(`/dashboard?error=${code}`);

  const form = await context.request.formData();
  const file = form.get("file");
  const learnedLanguage = form.get("learned_language");
  const knownLanguage = form.get("known_language");

  if (!(file instanceof File) || file.size === 0) {
    return fail("file-missing");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return fail("file-too-large");
  }
  if (!isAcceptedImageType(file.type)) {
    return fail("file-type");
  }
  if (
    typeof learnedLanguage !== "string" ||
    typeof knownLanguage !== "string" ||
    !isSupportedLanguage(learnedLanguage) ||
    !isSupportedLanguage(knownLanguage)
  ) {
    return fail("language-invalid");
  }
  if (learnedLanguage === knownLanguage) {
    return fail("language-same");
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

  return context.redirect("/dashboard?success=source-added");
};
