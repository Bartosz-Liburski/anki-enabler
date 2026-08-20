// Relative import, not the `@/` alias: this module is driven both by the Astro endpoint and by
// the plain-Node eval harness (scripts/eval-cards.ts), and a relative path resolves in both.
import { languageLabel } from "../languages";
import { MAX_CARDS } from "./card-schema";

export interface PromptOptions {
  /** Canonical language value from src/lib/languages.ts — the language being learned. */
  learnedLanguage: string;
  /** Canonical language value from src/lib/languages.ts — the language the user already knows. */
  knownLanguage: string;
  /**
   * Include the one-card-default instruction. Defaults to true.
   *
   * The eval harness (Phase 3) sweeps this off to quantify what that instruction is worth, so its
   * value is demonstrated rather than assumed. Production always leaves it on.
   */
  includeOneCardDefault?: boolean;
}

/**
 * Build the system prompt for one generation (S-02).
 *
 * Free of per-request interpolation beyond the language pair, so the prefix stays cacheable.
 *
 * The one-card default is the single highest-leverage instruction here, and it leads for that
 * reason: a stated cap reads as a quota unless you say otherwise. See card-schema.ts's MAX_CARDS
 * comment for why quota-filling is the failure mode this slice is most exposed to.
 */
export function buildSystemPrompt({
  learnedLanguage,
  knownLanguage,
  includeOneCardDefault = true,
}: PromptOptions): string {
  const learned = languageLabel(learnedLanguage);
  const known = languageLabel(knownLanguage);

  const oneCardDefault = `## How many cards

One card is the normal answer. Most screenshots capture a single phrase, sentence, or exchange, and that is one flashcard.

Produce more than one card ONLY when the image contains genuinely distinct learnable items — separate lines of lyrics, separate exchanges in a transcript, separate vocabulary entries on an exercise page — and then produce one card per item.

Never split a single phrase into fragments. Never restate the same phrase from a different angle. Never add cards to fill space. If you are in doubt between one card and several, return one.

The ${MAX_CARDS}-card ceiling below exists to bound runaway output. It is NOT a target and NOT a quota — approaching it on a source that does not warrant it is a failure, not thoroughness.`;

  const sections = [
    `You turn a screenshot of foreign-language material into Anki-style flashcards.

The user is learning ${learned} and already knows ${known}.`,
  ];

  if (includeOneCardDefault) {
    sections.push(oneCardDefault);
  }

  sections.push(
    `## Card orientation

\`front\` is the ${learned} text — the prompt side. \`back\` is its ${known} meaning — the answer side. Never swap them.`,

    `## Translations

If the image already shows a ${known} translation of the ${learned} text, reuse that translation verbatim on \`back\` rather than producing your own, and set \`sourceHadTranslation\` to true. If no translation is present, translate it yourself and set \`sourceHadTranslation\` to false.`,

    `## When there is nothing to learn

If the image contains no usable ${learned} material — no foreign-language text, unreadable text, or only content in ${known} — return an EMPTY \`cards\` array and put a short, specific explanation in \`emptyReason\` telling the user what you saw instead. Do not invent cards to avoid returning an empty set.

When you do return cards, \`emptyReason\` must be an empty string.`,

    `## Extraction confidence

Set \`extractionConfidence\` to "low" when the text was hard to read — blurred, cropped mid-word, low contrast, or handwritten — so the user knows to double-check it. Otherwise "high".`,

    `## Hard limit

Never return more than ${MAX_CARDS} cards under any circumstances.`,
  );

  return sections.join("\n\n");
}
