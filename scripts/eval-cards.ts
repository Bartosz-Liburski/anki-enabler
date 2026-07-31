/**
 * Eval harness for flashcard generation (S-02, Phase 3).
 *
 * Makes the >= 75%-kept bar (context/foundation/prd.md:36) measurable: runs every labelled
 * fixture through `generateCards` across a matrix of models, effort levels, and prompt variants,
 * then prints keep-rate **alongside count accuracy** per configuration.
 *
 * Reporting both is the point. A configuration that scores well on keep-rate while
 * over-generating is NOT passing: every padded card is individually defensible, so quota-filling
 * inflates the denominator while each card still looks correct in isolation. Printing the two
 * side by side is what stops that trade from hiding.
 *
 * Drives the generator directly — no Astro, no Supabase, no HTTP. That is why
 * src/lib/llm/generate-cards.ts takes an API key and image bytes as arguments.
 *
 * Usage:
 *   npm run eval                      # full matrix
 *   npm run eval -- --dry-run         # validate fixtures + print the matrix, no API calls
 *   npm run eval -- --only sonnet-medium
 *   npm run eval -- --fixture benvenuto
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateCards, GenerationError, type GenerateCardsInput } from "../src/lib/llm/generate-cards";
import { MAX_CARDS, type Card, type CardSet } from "../src/lib/llm/card-schema";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, "../context/changes/generate-and-review-cards/eval");

/** The bar this harness exists to measure (prd.md:36). */
const KEEP_RATE_BAR = 0.75;

interface Fixture {
  /** Basename of the label file, used as the fixture's id in output. */
  name: string;
  /** Image filename, relative to the fixture directory. */
  image: string;
  learnedLanguage: string;
  knownLanguage: string;
  /**
   * How many cards this source genuinely warrants. The load-bearing field: over-splitting is the
   * failure mode this slice is most exposed to, and it is invisible to a harness that only grades
   * card text.
   */
  expectedCardCount: number;
  expectedCards: ExpectedCard[];
  /** Whether a translation is already visible in the image. */
  sourceHadTranslation: boolean;
  note?: string;
}

/**
 * An expected card, plus any equally-correct wordings of its answer side.
 *
 * `backAlternatives` exists because when the source carries no translation the model produces its
 * own, and "I like writing a book" / "I like to write a book" are both right. Without this, a
 * correct card scores as a miss and keep-rate measures phrasing luck instead of quality. It does
 * NOT loosen `front`: the prompt side is extracted from the image, so it has one right answer.
 */
interface ExpectedCard extends Card {
  backAlternatives?: string[];
}

interface EvalConfig {
  name: string;
  model: GenerateCardsInput["model"];
  effort: GenerateCardsInput["effort"];
  /** Off for the comparison run that quantifies what the one-card-default instruction is worth. */
  includeOneCardDefault: boolean;
}

/**
 * The sweep. Sonnet 5 across three effort levels is the production candidate; the Opus 5 row is
 * the accuracy ceiling, and it is not optional: if Sonnet 5 misses the bar, that alone does not
 * say whether the model or the product hypothesis is at fault — this row separates the two.
 * `sonnet-medium-no-onecard` is the prompt-ablation control.
 */
const CONFIGS: EvalConfig[] = [
  { name: "sonnet-low", model: "claude-sonnet-5", effort: "low", includeOneCardDefault: true },
  { name: "sonnet-medium", model: "claude-sonnet-5", effort: "medium", includeOneCardDefault: true },
  { name: "sonnet-high", model: "claude-sonnet-5", effort: "high", includeOneCardDefault: true },
  { name: "opus-high", model: "claude-opus-5", effort: "high", includeOneCardDefault: true },
  {
    name: "sonnet-medium-no-onecard",
    model: "claude-sonnet-5",
    effort: "medium",
    includeOneCardDefault: false,
  },
];

// --------------------------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------------------------

function loadFixtures(filterName?: string): Fixture[] {
  if (!existsSync(FIXTURE_DIR)) {
    fail(`Fixture directory not found: ${rel(FIXTURE_DIR)}`);
  }

  const labelFiles = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));
  const fixtures = labelFiles.map((file) => parseFixture(file));

  if (fixtures.length === 0) {
    fail(
      `No fixtures in ${rel(FIXTURE_DIR)}. See its README.md — the set must include a zero-card ` +
        `source, several single-phrase sources, one with an in-image translation, one without, ` +
        `and at least one text-heavy source.`,
    );
  }

  const selected = filterName ? fixtures.filter((f) => f.name === filterName) : fixtures;
  if (selected.length === 0) {
    fail(`No fixture named '${filterName}'. Available: ${fixtures.map((f) => f.name).join(", ")}`);
  }
  return selected;
}

function parseFixture(file: string): Fixture {
  const name = path.basename(file, ".json");
  const raw = JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), "utf8")) as Partial<Fixture>;

  const required = [
    "image",
    "learnedLanguage",
    "knownLanguage",
    "expectedCardCount",
    "expectedCards",
    "sourceHadTranslation",
  ] as const;
  for (const key of required) {
    if (raw[key] === undefined) {
      fail(`Fixture '${name}' is missing required field '${key}'.`);
    }
  }

  const fixture = { ...raw, name } as Fixture;

  // Guard against label drift: a count that disagrees with the listed cards silently corrupts
  // both metrics at once, and the disagreement is invisible in the output.
  if (fixture.expectedCards.length !== fixture.expectedCardCount) {
    fail(
      `Fixture '${name}': expectedCardCount is ${fixture.expectedCardCount} but expectedCards ` +
        `lists ${fixture.expectedCards.length}. They must agree.`,
    );
  }
  if (fixture.expectedCardCount > MAX_CARDS) {
    fail(`Fixture '${name}': expectedCardCount ${fixture.expectedCardCount} exceeds MAX_CARDS.`);
  }
  if (!existsSync(path.join(FIXTURE_DIR, fixture.image))) {
    fail(`Fixture '${name}': image '${fixture.image}' not found in ${rel(FIXTURE_DIR)}.`);
  }

  return fixture;
}

function mediaTypeFor(image: string): GenerateCardsInput["mediaType"] {
  const ext = path.extname(image).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return fail(`Unsupported image extension '${ext}' — only .png, .jpg, .jpeg.`);
}

// --------------------------------------------------------------------------------------------
// Grading
// --------------------------------------------------------------------------------------------

/**
 * Normalize before comparing so trivia (case, surrounding punctuation, doubled spaces) does not
 * read as a quality failure. Diacritics are deliberately KEPT: in a language-learning card they
 * are part of the answer, and folding them would score a wrong card as correct.
 */
function normalize(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.,!?;:"'()[\]{}…]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A fixture that produced a card set. A discriminated union so `graded` needs no assertions. */
interface GradedResult {
  ok: true;
  fixture: Fixture;
  produced: CardSet;
  /** Generated cards whose front AND back match an expected card. */
  matched: number;
  /** Generated cards whose front matches but whose back differs — a human should eyeball these. */
  frontOnly: number;
  frontOnlyExamples: { produced: Card; expected: ExpectedCard }[];
}

interface FailedResult {
  ok: false;
  fixture: Fixture;
  errorCode: GenerationErrorCodeOrUnknown;
}

type FixtureResult = GradedResult | FailedResult;

type GenerationErrorCodeOrUnknown = GenerationError["code"] | "unknown";

/** Every wording of a card's answer side that counts as correct, normalized for comparison. */
function acceptedBacks(card: ExpectedCard): string[] {
  return [card.back, ...(card.backAlternatives ?? [])].map(normalize);
}

function grade(fixture: Fixture, produced: CardSet): Omit<GradedResult, "fixture" | "ok"> {
  const unmatched = fixture.expectedCards.map((card) => ({ card, taken: false }));
  let matched = 0;
  let frontOnly = 0;
  const frontOnlyExamples: GradedResult["frontOnlyExamples"] = [];

  // Two passes so an exact match is never consumed by a looser front-only match on the same
  // expected card.
  const leftover: Card[] = [];
  for (const card of produced.cards) {
    const hit = unmatched.find(
      (entry) =>
        !entry.taken &&
        normalize(entry.card.front) === normalize(card.front) &&
        acceptedBacks(entry.card).includes(normalize(card.back)),
    );
    if (hit) {
      hit.taken = true;
      matched += 1;
    } else {
      leftover.push(card);
    }
  }
  for (const card of leftover) {
    const hit = unmatched.find((entry) => !entry.taken && normalize(entry.card.front) === normalize(card.front));
    if (hit) {
      hit.taken = true;
      frontOnly += 1;
      frontOnlyExamples.push({ produced: card, expected: hit.card });
    }
  }

  return { produced, matched, frontOnly, frontOnlyExamples };
}

// --------------------------------------------------------------------------------------------
// Reporting
// --------------------------------------------------------------------------------------------

interface ConfigSummary {
  config: EvalConfig;
  results: FixtureResult[];
}

function isGraded(result: FixtureResult): result is GradedResult {
  return result.ok;
}

function reportConfig({ config, results }: ConfigSummary): void {
  const graded = results.filter(isGraded);
  const generated = sum(graded.map((r) => r.produced.cards.length));
  const matched = sum(graded.map((r) => r.matched));
  const frontOnly = sum(graded.map((r) => r.frontOnly));
  const keepRate = generated === 0 ? 0 : matched / generated;

  const over = graded.filter((r) => r.produced.cards.length > r.fixture.expectedCardCount);
  const under = graded.filter((r) => r.produced.cards.length < r.fixture.expectedCardCount);
  const exact = graded.filter((r) => r.produced.cards.length === r.fixture.expectedCardCount);

  const translationCorrect = graded.filter(
    (r) => r.produced.sourceHadTranslation === r.fixture.sourceHadTranslation,
  ).length;

  const zeroCardFixtures = graded.filter((r) => r.fixture.expectedCardCount === 0);
  const zeroCardOk = zeroCardFixtures.filter(
    (r) => r.produced.cards.length === 0 && r.produced.emptyReason.trim().length > 0,
  ).length;

  const errors = results.filter((r): r is FailedResult => !r.ok);

  console.log(`\n${"=".repeat(78)}`);
  console.log(
    `CONFIG ${config.name}  (${config.model}, effort=${config.effort}${
      config.includeOneCardDefault ? "" : ", one-card-default REMOVED"
    })`,
  );
  console.log("=".repeat(78));

  for (const r of results) {
    if (!r.ok) {
      console.log(`  ${pad(r.fixture.name, 28)} ERROR [${r.errorCode}]`);
      continue;
    }
    const produced = r.produced;
    const countMark =
      produced.cards.length === r.fixture.expectedCardCount
        ? "="
        : produced.cards.length > r.fixture.expectedCardCount
          ? "OVER"
          : "UNDER";
    console.log(
      `  ${pad(r.fixture.name, 28)} cards ${produced.cards.length}/${r.fixture.expectedCardCount} ${pad(countMark, 6)}` +
        ` matched ${r.matched}` +
        (r.frontOnly ? ` frontOnly ${r.frontOnly}` : "") +
        ` conf ${produced.extractionConfidence}` +
        ` translation ${produced.sourceHadTranslation === r.fixture.sourceHadTranslation ? "ok" : "WRONG"}`,
    );
    for (const example of r.frontOnlyExamples) {
      console.log(
        `      front matched, back differed: "${example.produced.back}" vs expected "${example.expected.back}"`,
      );
    }
    if (produced.cards.length === 0) {
      console.log(`      emptyReason: ${produced.emptyReason || "(EMPTY — this is a failure)"}`);
    }
  }

  console.log(`  ${"-".repeat(74)}`);
  console.log(`  KEEP-RATE      ${pct(keepRate)}  (${matched}/${generated} generated cards matched expectation)`);
  console.log(
    `                 ${keepRate >= KEEP_RATE_BAR ? "AT OR ABOVE" : "BELOW"} the >= ${pct(KEEP_RATE_BAR)} bar`,
  );
  console.log(
    `  COUNT ACCURACY exact ${exact.length}/${graded.length}   over-generation ${pct(rate(over.length, graded.length))}   under-generation ${pct(rate(under.length, graded.length))}`,
  );
  if (over.length > 0) {
    console.log(`                 over on: ${over.map((r) => r.fixture.name).join(", ")}`);
  }
  console.log(`  TRANSLATION    ${translationCorrect}/${graded.length} sourceHadTranslation correct`);
  if (zeroCardFixtures.length > 0) {
    console.log(
      `  ZERO-CARD      ${zeroCardOk}/${zeroCardFixtures.length} returned an empty set with a usable emptyReason`,
    );
  }
  if (frontOnly > 0) {
    console.log(
      `  NOTE           ${frontOnly} card(s) matched on front but not back — review above; a different-but-valid translation is not a failure, and if it is valid the label should be updated.`,
    );
  }
  if (errors.length > 0) {
    console.log(
      `  ERRORS         ${errors.length}: ${errors.map((r) => `${r.fixture.name}[${r.errorCode}]`).join(", ")}`,
    );
  }
}

function reportMatrix(summaries: ConfigSummary[]): void {
  console.log(`\n${"=".repeat(78)}`);
  console.log("SUMMARY — keep-rate and count accuracy side by side");
  console.log("=".repeat(78));
  console.log(`  ${pad("config", 28)} ${pad("keep-rate", 11)} ${pad("over-gen", 10)} ${pad("under-gen", 10)} exact`);
  for (const { config, results } of summaries) {
    const graded = results.filter(isGraded);
    const generated = sum(graded.map((r) => r.produced.cards.length));
    const matched = sum(graded.map((r) => r.matched));
    const over = graded.filter((r) => r.produced.cards.length > r.fixture.expectedCardCount).length;
    const under = graded.filter((r) => r.produced.cards.length < r.fixture.expectedCardCount).length;
    const exact = graded.length - over - under;
    console.log(
      `  ${pad(config.name, 28)} ${pad(pct(generated === 0 ? 0 : matched / generated), 11)} ` +
        `${pad(pct(rate(over, graded.length)), 10)} ${pad(pct(rate(under, graded.length)), 10)} ${exact}/${graded.length}`,
    );
  }
  console.log(
    `\n  A configuration with a good keep-rate and a high over-generation rate is NOT passing.\n` +
      `  Record both numbers in the plan's Progress section (steps 3.6 and 3.7).`,
  );
}

// --------------------------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const only = flagValue(args, "--only");
  const fixtureName = flagValue(args, "--fixture");

  const fixtures = loadFixtures(fixtureName);
  const configs = only ? CONFIGS.filter((c) => c.name === only) : CONFIGS;
  if (configs.length === 0) {
    fail(`No config named '${only}'. Available: ${CONFIGS.map((c) => c.name).join(", ")}`);
  }

  console.log(`Fixtures (${fixtures.length}): ${fixtures.map((f) => f.name).join(", ")}`);
  console.log(`Configs  (${configs.length}): ${configs.map((c) => c.name).join(", ")}`);
  console.log(`Total model calls: ${fixtures.length * configs.length}`);

  const zeroCard = fixtures.filter((f) => f.expectedCardCount === 0).length;
  const textHeavy = fixtures.filter((f) => f.expectedCardCount > 2).length;
  const singleCard = fixtures.filter((f) => f.expectedCardCount === 1).length;
  console.log(`Fixture mix: ${singleCard} single-card, ${textHeavy} text-heavy (>2), ${zeroCard} zero-card`);
  if (zeroCard === 0 || textHeavy === 0 || singleCard === 0) {
    console.log(
      "WARNING: the required mix is incomplete. Without single-card fixtures over-splitting is " +
        "undetectable, without a zero-card fixture the explanatory empty state is ungraded, and " +
        "without a text-heavy fixture legitimate multi-card output is ungraded.",
    );
  }

  if (dryRun) {
    console.log("\n--dry-run: fixtures parsed and matrix validated. No API calls made.");
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    fail("ANTHROPIC_API_KEY is not set. `npm run eval` loads .env if present.");
  }

  const summaries: ConfigSummary[] = [];
  for (const config of configs) {
    const results: FixtureResult[] = [];
    for (const fixture of fixtures) {
      process.stdout.write(`[${config.name}] ${fixture.name} ... `);
      // Sequential on purpose: one screenshot per call is cheap, and a fresh API key's rate
      // limits are low enough that fanning out would trade clean output for 429s.
      try {
        const produced = await generateCards({
          apiKey,
          model: config.model,
          effort: config.effort,
          includeOneCardDefault: config.includeOneCardDefault,
          imageBase64: readFileSync(path.join(FIXTURE_DIR, fixture.image)).toString("base64"),
          mediaType: mediaTypeFor(fixture.image),
          learnedLanguage: fixture.learnedLanguage,
          knownLanguage: fixture.knownLanguage,
        });
        results.push({ ok: true, fixture, ...grade(fixture, produced) });
        console.log(`${produced.cards.length} card(s)`);
      } catch (error) {
        const errorCode: GenerationErrorCodeOrUnknown = error instanceof GenerationError ? error.code : "unknown";
        results.push({ ok: false, fixture, errorCode });
        console.log(`ERROR [${errorCode}]`);
      }
    }
    summaries.push({ config, results });
    reportConfig({ config, results });
  }

  if (summaries.length > 1) {
    reportMatrix(summaries);
  }
}

// --------------------------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------------------------

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${flag} needs a value.`);
  }
  return value;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function pad(text: string, width: number): string {
  return text.padEnd(width);
}

function rel(target: string): string {
  return path.relative(process.cwd(), target);
}

function fail(message: string): never {
  console.error(`\nEval harness: ${message}`);
  process.exit(1);
}

await main();
