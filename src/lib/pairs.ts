/**
 * Rank a user's language pairs by recency for the pair nav.
 *
 * Pure — no Supabase, no Astro — same shape as `decks.ts`: a page runs its own lightweight query
 * (id, learned_language, known_language, created_at — no flashcards needed) and hands the rows
 * here rather than ranking in SQL.
 */

export interface PairSourceRow {
  learned_language: string;
  known_language: string;
  created_at: string;
}

export interface PairSummary {
  learnedLanguage: string;
  knownLanguage: string;
  mostRecentCreatedAt: string;
}

function pairKey(learnedLanguage: string, knownLanguage: string): string {
  return `${learnedLanguage} ${knownLanguage}`;
}

/**
 * One entry per distinct pair, newest first by its most recently added source.
 *
 * Ties break by pair key rather than input order, so two pairs whose newest source landed at the
 * same instant sort the same way across renders — the same stability concern `decks.ts`'s
 * `isEarlier` tiebreaker documents for card ordering.
 */
export function toPairSummaries(rows: readonly PairSourceRow[]): PairSummary[] {
  const summaries = new Map<string, PairSummary>();

  for (const row of rows) {
    const key = pairKey(row.learned_language, row.known_language);
    const existing = summaries.get(key);

    if (!existing || row.created_at.localeCompare(existing.mostRecentCreatedAt) > 0) {
      summaries.set(key, {
        learnedLanguage: row.learned_language,
        knownLanguage: row.known_language,
        mostRecentCreatedAt: row.created_at,
      });
    }
  }

  return [...summaries.values()].sort(
    (a, b) =>
      b.mostRecentCreatedAt.localeCompare(a.mostRecentCreatedAt) ||
      pairKey(a.learnedLanguage, a.knownLanguage).localeCompare(pairKey(b.learnedLanguage, b.knownLanguage)),
  );
}
