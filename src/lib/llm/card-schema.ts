import { z } from "zod";

/**
 * The shape one generation returns (S-02).
 *
 * Deliberately **flat and free of optional fields**. Optional fields are the shape most likely
 * to trip structured-output schema handling, and a required-but-empty string costs one token —
 * so `emptyReason` is always present and simply empty when cards exist.
 *
 * There is **no `.max()` on `cards`** and that is not an oversight: Claude's structured outputs
 * support no array constraints, and the SDK strips unsupported constraints from the schema it
 * sends to the API and validates them client-side instead. A `.max(15)` would therefore tell the
 * model nothing, let it generate 30 cards, bill all 30 output tokens, and only then throw. The
 * cap is enforced in the prompt, in `max_tokens`, and by truncating server-side.
 */
export const CardSetSchema = z.object({
  cards: z.array(
    z.object({
      front: z.string().describe("The prompt side of the card, in the learned language."),
      back: z.string().describe("The answer side of the card, in the known language."),
    }),
  ),
  sourceHadTranslation: z
    .boolean()
    .describe("True when a translation was already visible in the source and was reused."),
  extractionConfidence: z.enum(["high", "low"]).describe("'low' when the text in the image was hard to read."),
  emptyReason: z
    .string()
    .describe("Why no cards were produced. Empty string when cards were produced. Never a placeholder."),
});

export type CardSet = z.infer<typeof CardSetSchema>;
export type Card = CardSet["cards"][number];

/**
 * **Safety ceiling against runaway output — NOT an expected or target card count.**
 *
 * The expected output of a generation is *one* card: a typical screenshot captures a single
 * phrase worth learning. Several cards appear only when the source genuinely carries several
 * distinct learnable items. Reading this constant as a target re-introduces exactly the failure
 * the prompt is written to avoid: a model told "at most 15 cards" happily finds fifteen things
 * to say about one phrase, every padded card is individually defensible, and because the
 * kept-rate denominator counts them, quota-filling attacks the >= 75% quality bar directly while
 * each card still looks correct in isolation.
 */
export const MAX_CARDS = 15;

/**
 * Card count above which a response is treated as a hallucination rather than trimmed.
 *
 * Over-length hallucination is silent and repeatable (a model producing 16,400 characters from a
 * page containing 660, consistently enough to survive casual manual testing). Trimming such a
 * response to `MAX_CARDS` would hide the failure behind a plausible-looking result.
 */
export const HALLUCINATION_CARD_LIMIT = MAX_CARDS * 2;
