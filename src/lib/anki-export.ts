/**
 * The Anki CSV export format (S-03, FR-012) — the single place the format is spelled.
 *
 * Sits on `csv.ts` the way `source-errors.ts` sits over the endpoints: the mechanism below knows
 * nothing about this file, and everything Anki-specific lives here, so a format change is one
 * module. Relative import of `./csv` (not `@/lib/csv`) for the same reason the LLM modules use
 * relative sibling imports — `scripts/csv-smoke.ts` drives this from plain Node.
 *
 * **Two format decisions are load-bearing and easy to undo by accident:**
 *
 * 1. `#html:false`. Without it Anki treats every field as HTML, so a card containing `<` or `&`
 *    silently loses text on import — invisible until the user studies the card and finds a hole
 *    in it. This is the directive that matters most and the one with no visible failure mode.
 * 2. The directive block must be the FIRST thing in the file, ahead of any data row. Anki 2.1.55
 *    and newer honour these lines and skip them; an older Anki imports them as notes instead.
 *
 * The directives work because Anki ignores any line starting with `#` — which is also why the
 * front column is force-quoted below. A card reading `#throwback` would otherwise begin its line
 * with a `#` and be dropped on import with no error, the same class of silent loss as `#html`.
 *
 * There is deliberately no BOM. Anki requires UTF-8, and a byte-order mark ahead of
 * `#separator:comma` risks the first directive not being recognised. The accepted cost is that
 * Excel on a non-UTF-8 default shows mojibake for accented characters — Anki is the target
 * consumer, not a spreadsheet.
 */
import { CSV_DEFAULT_DELIMITER, CSV_RECORD_SEPARATOR, serializeCsv } from "./csv";

export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

/** One kept card, flattened with its source's learning direction. */
export interface ExportCard {
  front: string;
  back: string;
  /** ISO 639-1 code from the source row (`sources.learned_language`). */
  learnedLanguage: string;
  /** ISO 639-1 code from the source row (`sources.known_language`). */
  knownLanguage: string;
}

const TAG_NAMESPACE = "anki-enabler";

/**
 * The per-row Anki tag: `anki-enabler::it-pl`. One hierarchical tag, not two.
 *
 * `::` is Anki's hierarchy separator, so every export lands under a single `anki-enabler` parent in
 * the sidebar and each pair is a child of it. A bare `it::pl` would instead plant a top-level `it`
 * node in the user's tag tree, next to whatever else they study.
 *
 * No escaping is needed and none is done: an Anki tag cannot contain a space (a space starts a new
 * tag), and both codes are curated ISO 639-1 alpha-2 values validated against `LANGUAGES` before
 * they are ever written to a source row. The safety is structural, not defensive.
 */
export function pairTag(learnedLanguage: string, knownLanguage: string): string {
  return `${TAG_NAMESPACE}::${learnedLanguage}-${knownLanguage}`;
}

/**
 * File-level directives, emitted verbatim ahead of the rows. Together they remove every choice
 * from Anki's import dialog: how fields are split, whether they are HTML, which notetype receives
 * them, and which column carries tags.
 */
const DIRECTIVES = ["#separator:comma", "#html:false", "#notetype:Basic", "#tags column:3"] as const;

export const ANKI_DIRECTIVE_BLOCK = DIRECTIVES.join(CSV_RECORD_SEPARATOR) + CSV_RECORD_SEPARATOR;

/**
 * Build the download filename: `anki-enabler-it-pl-2026-08-11.csv` for one source's pair,
 * `anki-enabler-all-2026-08-11.csv` when the export spans every source.
 *
 * The date is UTC (`toISOString`) rather than local. A filename is a label, not a timestamp anyone
 * audits, and a deterministic one keeps the value reproducible from a given `Date`.
 */
export function exportFilename(date: Date, pair?: { learnedLanguage: string; knownLanguage: string }): string {
  const day = date.toISOString().slice(0, 10);
  const scope = pair ? `${pair.learnedLanguage}-${pair.knownLanguage}` : "all";
  return `${TAG_NAMESPACE}-${scope}-${day}.csv`;
}

/**
 * Column 0 is quoted unconditionally so no data line can ever begin with a `#` that Anki would
 * read as a comment. Quoting every front rather than only the ones that start with `#` keeps the
 * rule unconditional — there is no branch to get wrong, and a fully-quoted column is still
 * ordinary RFC 4180.
 */
const FORCE_QUOTE_COLUMNS = [0];

/** Columns are front, back, tags — in that order, which is what `#tags column:3` refers to. */
export function buildAnkiCsv(cards: readonly ExportCard[]): string {
  const rows = cards.map((card) => [card.front, card.back, pairTag(card.learnedLanguage, card.knownLanguage)]);
  return ANKI_DIRECTIVE_BLOCK + serializeCsv(rows, CSV_DEFAULT_DELIMITER, FORCE_QUOTE_COLUMNS);
}

/**
 * Response headers for a CSV download, so both export routes stay byte-identical on this.
 *
 * The filename is interpolated unquoted-escaped on purpose: `exportFilename` composes it from
 * curated language codes and an ISO date, so it cannot contain a `"` to break out of the header.
 */
export function csvDownloadHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": CSV_CONTENT_TYPE,
    "Content-Disposition": `attachment; filename="${filename}"`,
  };
}
