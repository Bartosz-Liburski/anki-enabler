/**
 * Outcome codes carried on the `?error=` / `?success=` query param after `POST /api/sources`
 * redirects back to the dashboard (S-01).
 *
 * The endpoint picks the code, the dashboard renders the message — keeping both the union and
 * the copy here means a renamed code breaks type checking instead of silently rendering nothing.
 */

export type SourceErrorCode =
  | "file-missing"
  | "file-too-large"
  | "file-type"
  | "language-invalid"
  | "language-same"
  | "upload-failed"
  | "save-failed";

export const SOURCE_ERROR_MESSAGES: Record<SourceErrorCode, string> = {
  "file-missing": "Pick a screenshot to upload.",
  "file-too-large": "That image is larger than 5 MB. Pick a smaller screenshot.",
  "file-type": "Only PNG or JPEG screenshots are supported.",
  "language-invalid": "Pick both languages from the list.",
  "language-same": "The language you're learning and the one you know must be different.",
  "upload-failed": "Uploading the screenshot failed. Try again.",
  "save-failed": "Saving the source failed. Nothing was stored — try again.",
};

export const SOURCE_SUCCESS_CODE = "source-added";

export const SOURCE_SUCCESS_MESSAGE = "Screenshot added. It's ready to turn into flashcards.";

export function sourceErrorMessage(code: string | null): string | null {
  if (!code) return null;
  // The param is user-controllable, so an unrecognised code must not render an empty banner.
  if (code in SOURCE_ERROR_MESSAGES) {
    return SOURCE_ERROR_MESSAGES[code as SourceErrorCode];
  }
  return "Something went wrong. Try again.";
}
