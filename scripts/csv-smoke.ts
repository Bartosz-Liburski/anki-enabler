/**
 * Escaping smoke checks for the CSV export (S-03, Phase 1).
 *
 * This repo has no test framework, and RFC 4180 escaping is exactly the kind of rule that a manual
 * click-through cannot reach: a broken quote does not throw, it shifts a column, and the result
 * still looks like plausible text. So the rules get a script, in the shape `scripts/eval-cards.ts`
 * established — driven through `tsx`, exiting non-zero on failure.
 *
 * Assertions are on exact serialized output rather than through a parser. A parser written here
 * would itself be unverified; the bytes are the contract, and Anki is what parses them.
 *
 * Usage:
 *   npm run csv:smoke
 */
import { CSV_RECORD_SEPARATOR, csvRow, escapeCsvField, serializeCsv } from "../src/lib/csv";
import { ANKI_DIRECTIVE_BLOCK, buildAnkiCsv, exportFilename, pairTag, type ExportCard } from "../src/lib/anki-export";

const CRLF = CSV_RECORD_SEPARATOR;

interface Check {
  name: string;
  actual: string;
  expected: string;
}

const checks: Check[] = [
  // ---------------------------------------------------------------------------------------
  // RFC 4180 escaping
  // ---------------------------------------------------------------------------------------
  {
    name: "plain field is emitted bare",
    actual: escapeCsvField("ciao"),
    expected: "ciao",
  },
  {
    name: "field containing the delimiter is quoted",
    actual: escapeCsvField("Mi piace, davvero"),
    expected: '"Mi piace, davvero"',
  },
  {
    name: "embedded double quote is doubled and the field quoted",
    actual: escapeCsvField('lui disse "ciao"'),
    expected: '"lui disse ""ciao"""',
  },
  {
    name: "field containing LF is quoted with the newline preserved verbatim",
    actual: escapeCsvField("riga uno\nriga due"),
    expected: '"riga uno\nriga due"',
  },
  {
    name: "field containing CRLF is quoted with the break preserved verbatim",
    actual: escapeCsvField("riga uno\r\nriga due"),
    expected: '"riga uno\r\nriga due"',
  },
  {
    name: "a semicolon is not special when the delimiter is a comma",
    actual: escapeCsvField("uno; due"),
    expected: "uno; due",
  },
  {
    name: "forceQuote quotes a field RFC 4180 would leave bare",
    actual: escapeCsvField("ciao", ",", true),
    expected: '"ciao"',
  },
  {
    name: "forceQuoteColumns quotes only the named column",
    actual: csvRow(["uno", "due", "tre"], ",", [0]),
    expected: '"uno",due,tre',
  },
  {
    name: "records are CRLF-terminated, including the last",
    actual: serializeCsv([
      ["a", "b"],
      ["c", "d"],
    ]),
    expected: `a,b${CRLF}c,d${CRLF}`,
  },
  {
    name: "zero rows serialize to the empty string, not a lone CRLF",
    actual: serializeCsv([]),
    expected: "",
  },

  // ---------------------------------------------------------------------------------------
  // Anki format
  // ---------------------------------------------------------------------------------------
  {
    name: "directive block is exactly the four directives, CRLF-terminated",
    actual: ANKI_DIRECTIVE_BLOCK,
    expected: `#separator:comma${CRLF}#html:false${CRLF}#notetype:Basic${CRLF}#tags column:3${CRLF}`,
  },
  {
    name: "the pair tag is one hierarchical tag under the namespace",
    actual: pairTag("it", "pl"),
    expected: "anki-enabler::it-pl",
  },
  {
    name: "an empty card set is the directive block and nothing else",
    actual: buildAnkiCsv([]),
    expected: ANKI_DIRECTIVE_BLOCK,
  },
  {
    name: "directives precede the first data row",
    actual: buildAnkiCsv([card("ciao", "cześć")]).slice(0, ANKI_DIRECTIVE_BLOCK.length),
    expected: ANKI_DIRECTIVE_BLOCK,
  },
  {
    name: "a card row is front, back, tag with the front quoted",
    actual: buildAnkiCsv([card("ciao", "cześć")]).slice(ANKI_DIRECTIVE_BLOCK.length),
    expected: `"ciao",cześć,anki-enabler::it-pl${CRLF}`,
  },
  {
    // The case that motivated force-quoting column 0: Anki drops any line beginning with '#',
    // which is the same rule the directives above rely on.
    name: "a front starting with # cannot begin its line with #",
    actual: buildAnkiCsv([card("#throwback", "powrót")]).slice(ANKI_DIRECTIVE_BLOCK.length),
    expected: `"#throwback",powrót,anki-enabler::it-pl${CRLF}`,
  },
  {
    name: "a card containing a comma and a quote survives into one row",
    actual: buildAnkiCsv([card('Mi piace, davvero "molto"', "Bardzo mi się podoba")]).slice(
      ANKI_DIRECTIVE_BLOCK.length,
    ),
    expected: `"Mi piace, davvero ""molto""",Bardzo mi się podoba,anki-enabler::it-pl${CRLF}`,
  },
  {
    name: "angle brackets pass through untouched (#html:false does the work, not escaping)",
    actual: buildAnkiCsv([card("<b>grassetto</b>", "pogrubienie")]).slice(ANKI_DIRECTIVE_BLOCK.length),
    expected: `"<b>grassetto</b>",pogrubienie,anki-enabler::it-pl${CRLF}`,
  },
  {
    name: "each row carries its own source's pair tag",
    actual: buildAnkiCsv([card("ciao", "cześć"), card("hola", "hej", "es", "en")]).slice(ANKI_DIRECTIVE_BLOCK.length),
    expected: `"ciao",cześć,anki-enabler::it-pl${CRLF}` + `"hola",hej,anki-enabler::es-en${CRLF}`,
  },

  // ---------------------------------------------------------------------------------------
  // Filenames
  // ---------------------------------------------------------------------------------------
  {
    name: "per-source filename carries the pair and the date",
    actual: exportFilename(new Date("2026-08-11T09:30:00Z"), { learnedLanguage: "it", knownLanguage: "pl" }),
    expected: "anki-enabler-it-pl-2026-08-11.csv",
  },
  {
    name: "account-wide filename says all",
    actual: exportFilename(new Date("2026-08-11T09:30:00Z")),
    expected: "anki-enabler-all-2026-08-11.csv",
  },
];

function card(front: string, back: string, learnedLanguage = "it", knownLanguage = "pl"): ExportCard {
  return { front, back, learnedLanguage, knownLanguage };
}

function main(): void {
  let failed = 0;

  for (const check of checks) {
    const passed = check.actual === check.expected;
    if (!passed) failed += 1;
    console.log(`  ${passed ? "PASS" : "FAIL"}  ${check.name}`);
    if (!passed) {
      console.log(`        expected ${JSON.stringify(check.expected)}`);
      console.log(`        actual   ${JSON.stringify(check.actual)}`);
    }
  }

  console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);

  if (failed > 0) {
    console.error(`\ncsv-smoke: ${failed} check(s) failed.`);
    process.exit(1);
  }

  // Printed so the format can be eyeballed, and so the manual verification step has a file to
  // save and drag into a real Anki install — the only check that proves the directives are right.
  console.log("\nSample document (save as .csv and import into Anki to verify the format):\n");
  console.log(
    buildAnkiCsv([
      card("Mi piace, davvero", "Bardzo mi się podoba"),
      card("lui disse “ciao”", "powiedział „cześć”"),
      card("#throwback", "powrót do przeszłości"),
      card("<b>grassetto</b>", "pogrubienie"),
      card("hola", "hej", "es", "en"),
    ]),
  );
}

main();
