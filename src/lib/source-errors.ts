/**
 * Outcome codes carried on the `?error=` / `?success=` query param after a source endpoint
 * redirects (S-01 to the dashboard, S-02 to `/sources/{id}`).
 *
 * The endpoint picks the code, the page renders the message — keeping both the union and the copy
 * here means a renamed code breaks type checking instead of silently rendering nothing.
 */
// `import type` only: erased at build time, so importing the generator's error union here does not
// pull the Anthropic SDK into every page that renders a banner.
import type { GenerationErrorCode } from "@/lib/llm/generate-cards";

export type SourceErrorCode =
  // Source creation (S-01)
  | "file-missing"
  | "file-too-large"
  | "file-type"
  | "language-invalid"
  | "language-same"
  | "upload-failed"
  | "save-failed"
  // Flashcard generation (S-02)
  | "source-not-found"
  | "source-image-missing"
  | "generation-unconfigured"
  | "generation-confirm-required"
  | "generation-refused"
  | "generation-truncated"
  | "generation-invalid"
  | "generation-implausible"
  | "generation-failed"
  | "cards-save-failed"
  | "review-save-failed"
  // CSV export (S-03)
  | "export-empty"
  | "export-failed"
  // Source deletion (S-04)
  | "delete-confirm-required"
  | "delete-failed";

export const SOURCE_ERROR_MESSAGES: Record<SourceErrorCode, string> = {
  "file-missing": "Pick a screenshot to upload.",
  "file-too-large": "That image is larger than 5 MB. Pick a smaller screenshot.",
  "file-type": "Only PNG or JPEG screenshots are supported.",
  "language-invalid": "Pick both languages from the list.",
  "language-same": "The language you're learning and the one you know must be different.",
  "upload-failed": "Uploading the screenshot failed. Try again.",
  "save-failed": "Saving the source failed. Nothing was stored — try again.",
  // Deliberately the same message for "no such source" and "someone else's source": RLS scopes
  // the lookup to the owner, so the endpoint cannot tell them apart — and telling a user that a
  // source exists but isn't theirs would leak the existence of other people's rows.
  "source-not-found": "That source doesn't exist.",
  "source-image-missing": "This source has no screenshot to read, so it can't be generated from.",
  "generation-unconfigured": "Flashcard generation isn't configured on this deployment yet.",
  "generation-confirm-required": "This source already has flashcards. Confirm to replace them.",
  "generation-refused": "The generation service declined to process this screenshot.",
  "generation-truncated": "The response was cut off before it was complete. Nothing was saved — try again.",
  "generation-invalid": "The generation service returned something unusable. Nothing was saved — try again.",
  "generation-implausible":
    "The generation service returned far more cards than this source warrants. Nothing was saved.",
  "generation-failed": "Generating flashcards failed. Your previous cards are untouched — try again.",
  "cards-save-failed": "The cards were generated but saving them failed. Try again.",
  "review-save-failed": "Saving your keep/discard choices failed. Nothing changed — try again.",
  // Reachable only by requesting an export URL directly — the UI hides the link when nothing is
  // kept. Worth a real message anyway: a bookmarked export URL still works after every card on
  // that source has been discarded.
  "export-empty": "There are no kept flashcards to export. Keep at least one card first.",
  "export-failed": "Building the CSV export failed. Nothing was downloaded — try again.",
  // Reachable only by posting to the delete route without the confirm field — the island always
  // sends it. The guard is server-side precisely so an unhydrated or bypassed page cannot delete.
  "delete-confirm-required": "Deleting a source needs confirmation. Nothing was deleted.",
  "delete-failed": "Deleting this source failed. Nothing was deleted — try again.",
};

/**
 * The export codes, as a value the dashboard can test against.
 *
 * The dashboard routes these two to their own banner instead of the upload form's error slot, and
 * spelling them as bare string literals there would make a rename type-check clean while silently
 * turning the split off. `satisfies` keeps this list honest against the union above.
 */
export const EXPORT_ERROR_CODES = ["export-empty", "export-failed"] as const satisfies readonly SourceErrorCode[];

export function isExportErrorCode(code: string | null): boolean {
  return code !== null && (EXPORT_ERROR_CODES as readonly string[]).includes(code);
}

export const SOURCE_SUCCESS_CODE = "source-added";

export const SOURCE_SUCCESS_MESSAGE = "Screenshot added. It's ready to turn into flashcards.";

/** Generation produced cards. The count rides along in a `count` param. */
export const CARDS_GENERATED_CODE = "cards-generated";

/**
 * Generation ran and legitimately produced nothing — a distinct signal from an error, because the
 * source's `generation_note` holds the model's explanation and the review screen renders it.
 */
export const CARDS_NONE_CODE = "cards-none";

/** The review screen's keep/discard choices were persisted. */
export const CARDS_SAVED_CODE = "cards-saved";

/**
 * A source and everything belonging to it are gone (S-04). Lands on the dashboard, not the source
 * page — that page no longer exists.
 */
export const SOURCE_DELETED_CODE = "source-deleted";

export type SourceSuccessCode =
  | typeof SOURCE_SUCCESS_CODE
  | typeof CARDS_GENERATED_CODE
  | typeof CARDS_NONE_CODE
  | typeof CARDS_SAVED_CODE
  | typeof SOURCE_DELETED_CODE;

export function sourceErrorMessage(code: string | null): string | null {
  if (!code) return null;
  // The param is user-controllable, so an unrecognised code must not render an empty banner.
  if (code in SOURCE_ERROR_MESSAGES) {
    return SOURCE_ERROR_MESSAGES[code as SourceErrorCode];
  }
  return "Something went wrong. Try again.";
}

/**
 * Copy for a `?success=` code. Returns null for anything unrecognised — unlike the error path
 * there is no generic fallback, because a made-up success param must not congratulate the user.
 */
export function sourceSuccessMessage(code: string | null, count?: number): string | null {
  switch (code) {
    case SOURCE_SUCCESS_CODE:
      return SOURCE_SUCCESS_MESSAGE;
    case CARDS_GENERATED_CODE:
      return count === 1
        ? "Generated 1 flashcard. Discard it if it isn't worth keeping, then save."
        : `Generated ${count ?? 0} flashcards. Discard the weak ones, then save.`;
    case CARDS_NONE_CODE:
      return "No flashcards could be made from this screenshot. The reason is below.";
    case SOURCE_DELETED_CODE:
      return "Source deleted, along with its flashcards and its screenshot.";
    case CARDS_SAVED_CODE:
      return "Saved. The cards you kept are the ones you'll export.";
    default:
      return null;
  }
}

/**
 * Map a generator failure onto the outcome vocabulary the UI already speaks.
 *
 * A `Record` rather than a `switch` on purpose: adding a `GenerationErrorCode` without deciding
 * what the user should see becomes a type error instead of an unhandled case falling through to a
 * generic message.
 */
const SOURCE_ERROR_BY_GENERATION_ERROR: Record<GenerationErrorCode, SourceErrorCode> = {
  refusal: "generation-refused",
  truncated: "generation-truncated",
  "schema-invalid": "generation-invalid",
  hallucinated: "generation-implausible",
  "upstream-failed": "generation-failed",
};

export function generationErrorCode(code: GenerationErrorCode): SourceErrorCode {
  return SOURCE_ERROR_BY_GENERATION_ERROR[code];
}
