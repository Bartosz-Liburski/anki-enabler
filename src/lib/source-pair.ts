import type { AstroCookies } from "astro";
import { isSupportedLanguage } from "@/lib/languages";

/**
 * Where the chosen learning direction lives (S-01).
 *
 * The URL is the rendering source of truth — the dashboard branches on its query params, and
 * `POST /api/sources` echoes them back so one pair takes many uploads in a row. This cookie is
 * only the *recall* layer: it survives closing the tab, and a bare `/dashboard` visit is
 * redirected to the canonical pair URL so there is still exactly one code path for rendering.
 *
 * Read values are re-validated against the curated language list rather than trusted, since a
 * cookie is client-supplied.
 */

export const PAIR_COOKIE = "anki_source_pair";

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

export interface LanguagePair {
  learnedLanguage: string;
  knownLanguage: string;
}

export function isValidPair(learnedLanguage: string, knownLanguage: string): boolean {
  return (
    isSupportedLanguage(learnedLanguage) && isSupportedLanguage(knownLanguage) && learnedLanguage !== knownLanguage
  );
}

export function readPairCookie(cookies: AstroCookies): LanguagePair | null {
  const raw = cookies.get(PAIR_COOKIE)?.value;
  if (!raw) return null;

  const [learnedLanguage = "", knownLanguage = ""] = raw.split(":");
  return isValidPair(learnedLanguage, knownLanguage) ? { learnedLanguage, knownLanguage } : null;
}

export function writePairCookie(cookies: AstroCookies, pair: LanguagePair): void {
  cookies.set(PAIR_COOKIE, `${pair.learnedLanguage}:${pair.knownLanguage}`, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: import.meta.env.PROD,
    maxAge: ONE_YEAR_IN_SECONDS,
  });
}

export function clearPairCookie(cookies: AstroCookies): void {
  cookies.delete(PAIR_COOKIE, { path: "/" });
}

/** Build a `/dashboard` URL; the single place that spells these param names. */
export function dashboardUrl(params: Record<string, string>): string {
  return `/dashboard?${new URLSearchParams(params).toString()}`;
}

export function dashboardPairUrl(pair: LanguagePair): string {
  return dashboardUrl({ learned_language: pair.learnedLanguage, known_language: pair.knownLanguage });
}
