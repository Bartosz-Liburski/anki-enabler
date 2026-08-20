/**
 * Turn the dashboard's source rows into the grouped deck list it renders (S-04, FR-005 + FR-011).
 *
 * Pure — no Supabase, no Astro — so the two rules that are easy to get subtly wrong live in one
 * readable place instead of inside a template expression:
 *
 * 1. **A deck's label is its first card's front, and a deck may have no cards.** A source that was
 *    never generated, or that generated zero cards, is a real and already-rendered state
 *    (`sources/[id].astro:46-47`), so `flashcards[0]` cannot be assumed to exist.
 * 2. **"First" needs a tiebreaker.** A generation inserts all of a source's cards in ONE statement
 *    (`generate.ts:123`), so they share a `created_at` to the microsecond and their relative order
 *    is otherwise up to Postgres — the same trap S-03's export hit. Ordering by `created_at` then
 *    `id` makes the label stable across reloads.
 *
 * Sorting happens here rather than being inherited from the query, so the function is correct for
 * any input order and can be reasoned about on its own. The query orders too, which costs nothing
 * and keeps the two agreeing.
 */
import { languageLabel } from "./languages";

/** Shown instead of a first card when a source has none. */
export const NO_CARDS_LABEL = "No cards yet";

export interface DeckCardRow {
  id: string;
  front: string;
  discarded: boolean;
  created_at: string;
}

/** One `sources` row with its cards embedded, as the dashboard's query returns it. */
export interface DeckSourceRow {
  id: string;
  learned_language: string;
  known_language: string;
  created_at: string;
  flashcards: DeckCardRow[];
}

export interface Deck {
  id: string;
  learnedLanguage: string;
  knownLanguage: string;
  /** The first card's front, or `NO_CARDS_LABEL`. Not truncated — the template clamps it. */
  label: string;
  keptCount: number;
  totalCount: number;
  createdAt: string;
}

export interface DeckGroup {
  learnedLanguage: string;
  knownLanguage: string;
  decks: Deck[];
}

/** Ascending by `created_at`, then `id` — see the tiebreaker note above. */
function isEarlier(candidate: DeckCardRow, current: DeckCardRow): boolean {
  if (candidate.created_at !== current.created_at) {
    return candidate.created_at < current.created_at;
  }
  return candidate.id < current.id;
}

function toDeck(row: DeckSourceRow): Deck {
  const cards = row.flashcards;
  const first = cards.reduce<DeckCardRow | null>(
    (earliest, card) => (earliest === null || isEarlier(card, earliest) ? card : earliest),
    null,
  );

  return {
    id: row.id,
    learnedLanguage: row.learned_language,
    knownLanguage: row.known_language,
    label: first?.front ?? NO_CARDS_LABEL,
    // Kept is the complement of discarded — the schema's own definition
    // (20260731075155_add_flashcard_fields.sql:29), and the same one S-03's export uses.
    keptCount: cards.filter((card) => !card.discarded).length,
    totalCount: cards.length,
    createdAt: row.created_at,
  };
}

function pairKey(learnedLanguage: string, knownLanguage: string): string {
  return `${learnedLanguage} ${knownLanguage}`;
}

/**
 * Group decks by learning direction, newest first inside each group.
 *
 * Groups are ordered by their human-readable labels rather than their ISO codes, so the list reads
 * alphabetically to the user ("German → Polish" before "Italian → Polish") rather than by an
 * ordering only the database cares about.
 */
export function toDeckGroups(rows: readonly DeckSourceRow[]): DeckGroup[] {
  const groups = new Map<string, DeckGroup>();

  for (const row of rows) {
    const key = pairKey(row.learned_language, row.known_language);
    let group = groups.get(key);
    if (!group) {
      group = {
        learnedLanguage: row.learned_language,
        knownLanguage: row.known_language,
        decks: [],
      };
      groups.set(key, group);
    }
    group.decks.push(toDeck(row));
  }

  for (const group of groups.values()) {
    // Newest first; `id` breaks the tie so two sources added in the same instant do not swap
    // positions between renders.
    group.decks.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  return [...groups.values()].sort(
    (a, b) =>
      languageLabel(a.learnedLanguage).localeCompare(languageLabel(b.learnedLanguage)) ||
      languageLabel(a.knownLanguage).localeCompare(languageLabel(b.knownLanguage)),
  );
}
