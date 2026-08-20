/**
 * Curated language list backing the learning-direction dropdowns (S-01).
 *
 * The `value` (ISO 639-1 code) is what lands in `sources.learned_language` /
 * `sources.known_language`, so stored values stay normalized for S-02's generation prompt.
 * The endpoint validates submitted values against this list — anything outside it is rejected.
 */

export interface Language {
  /** ISO 639-1 code; the canonical value persisted on the source row. */
  value: string;
  /** English display name shown in the dropdowns. */
  label: string;
}

export const LANGUAGES: readonly Language[] = [
  { value: "ar", label: "Arabic" },
  { value: "bn", label: "Bengali" },
  { value: "cs", label: "Czech" },
  { value: "da", label: "Danish" },
  { value: "de", label: "German" },
  { value: "el", label: "Greek" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fi", label: "Finnish" },
  { value: "fr", label: "French" },
  { value: "he", label: "Hebrew" },
  { value: "hi", label: "Hindi" },
  { value: "hu", label: "Hungarian" },
  { value: "id", label: "Indonesian" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "nl", label: "Dutch" },
  { value: "no", label: "Norwegian" },
  { value: "pl", label: "Polish" },
  { value: "pt", label: "Portuguese" },
  { value: "ro", label: "Romanian" },
  { value: "ru", label: "Russian" },
  { value: "sv", label: "Swedish" },
  { value: "th", label: "Thai" },
  { value: "tr", label: "Turkish" },
  { value: "uk", label: "Ukrainian" },
  { value: "vi", label: "Vietnamese" },
  { value: "zh", label: "Chinese" },
] as const;

export function isSupportedLanguage(value: string): boolean {
  return LANGUAGES.some((language) => language.value === value);
}

export function languageLabel(value: string): string {
  return LANGUAGES.find((language) => language.value === value)?.label ?? value;
}
