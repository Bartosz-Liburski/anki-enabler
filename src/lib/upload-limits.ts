/**
 * Single source of truth for the source-upload size/format cap (S-01).
 *
 * These values are enforced at three points and must agree:
 *  1. the client island (fast fail before POSTing),
 *  2. `POST /api/sources` (authoritative — the NFR must hold even if the client is bypassed),
 *  3. the `screenshots` bucket itself (`file_size_limit` + `allowed_mime_types`), which mirrors
 *     them in `supabase/migrations/20260726105652_add_screenshot_source_fields.sql` and
 *     `supabase/config.toml` as the last line of defense.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg"] as const;

export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

/** Human-readable forms for validation messages and the file input's `accept` attribute. */
export const MAX_UPLOAD_LABEL = "5 MB";
export const ACCEPTED_IMAGE_LABEL = "PNG or JPEG";
export const ACCEPTED_IMAGE_ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_TYPES.join(",");

/** File extension stored for each accepted mime type, keeping `image_path` predictable. */
const EXTENSION_BY_IMAGE_TYPE: Record<AcceptedImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

export function isAcceptedImageType(mimeType: string): mimeType is AcceptedImageType {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

export function extensionForImageType(mimeType: AcceptedImageType): string {
  return EXTENSION_BY_IMAGE_TYPE[mimeType];
}

/**
 * The inverse: recover the mime type from a stored `image_path` extension (S-02).
 *
 * Trustworthy because `POST /api/sources` wrote that extension via `extensionForImageType`, from a
 * mime type it had already validated. Derived here rather than re-sniffed so the two directions
 * cannot drift; returns null for anything unrecognised instead of guessing.
 */
export function imageTypeForPath(imagePath: string): AcceptedImageType | null {
  const extension = imagePath.split(".").pop()?.toLowerCase() ?? "";
  const match = Object.entries(EXTENSION_BY_IMAGE_TYPE).find(([, ext]) => ext === extension);
  return match ? (match[0] as AcceptedImageType) : null;
}
