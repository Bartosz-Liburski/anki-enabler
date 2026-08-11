/**
 * RFC 4180 CSV serialization (S-03).
 *
 * Deliberately knows nothing about Anki, flashcards, or the export routes. This module owns the
 * escaping rules and nothing else, which is what lets `scripts/csv-smoke.ts` exercise them with no
 * database, no Astro, and no network — the same seam that made S-02's generator drivable from the
 * eval harness. The Anki-specific layer sits on top in `anki-export.ts`.
 *
 * Escaping is the entire reason this file exists. A card reading `Mi piace, davvero` splits into
 * two columns without it and every following field in that row shifts — a corruption that reads as
 * a generation failure rather than a serialization bug, because each field still looks like
 * plausible text.
 */

/** RFC 4180 §2.1: records are terminated by CRLF, not a bare LF. */
export const CSV_RECORD_SEPARATOR = "\r\n";

export const CSV_DEFAULT_DELIMITER = ",";

/**
 * Quote a field that contains the delimiter, a double quote, or a line break, doubling any
 * embedded double quote (RFC 4180 §2.5–2.7). Everything else is emitted bare unless `forceQuote`
 * asks otherwise — the spec permits quoting any field, so a consumer with its own reason to demand
 * quotes stays inside the format.
 *
 * The delimiter is a parameter rather than a baked-in constant so that changing the format later
 * is a call-site edit instead of a rewrite of the escaping rules.
 */
export function escapeCsvField(value: string, delimiter: string = CSV_DEFAULT_DELIMITER, forceQuote = false): string {
  const mustQuote =
    forceQuote || value.includes(delimiter) || value.includes('"') || value.includes("\n") || value.includes("\r");
  return mustQuote ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * `forceQuoteColumns` names column indexes to quote unconditionally. It exists because a consumer
 * may care what character a *line* starts with, which is a property of the first column that
 * RFC 4180 itself has no opinion about — see `anki-export.ts`, where an unquoted leading `#` makes
 * Anki drop the row.
 */
export function csvRow(
  fields: readonly string[],
  delimiter: string = CSV_DEFAULT_DELIMITER,
  forceQuoteColumns: readonly number[] = [],
): string {
  return fields
    .map((field, index) => escapeCsvField(field, delimiter, forceQuoteColumns.includes(index)))
    .join(delimiter);
}

/**
 * Serialize rows into a CSV document, CRLF-terminated including the final record.
 *
 * That trailing separator is deliberate: it makes prefixing a prelude (Anki's directive block) a
 * plain string concatenation with no "is this the last line" special case. Zero rows produce the
 * empty string rather than a lone CRLF, so an empty body adds nothing to a prelude.
 */
export function serializeCsv(
  rows: readonly (readonly string[])[],
  delimiter: string = CSV_DEFAULT_DELIMITER,
  forceQuoteColumns: readonly number[] = [],
): string {
  if (rows.length === 0) return "";
  return rows.map((row) => csvRow(row, delimiter, forceQuoteColumns)).join(CSV_RECORD_SEPARATOR) + CSV_RECORD_SEPARATOR;
}
