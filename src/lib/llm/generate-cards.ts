import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// Relative imports, not the `@/` alias — see the note in prompt.ts.
import { CardSetSchema, HALLUCINATION_CARD_LIMIT, MAX_CARDS, type CardSet } from "./card-schema";
import { buildSystemPrompt } from "./prompt";

/**
 * The one Claude vision call that turns a screenshot into flashcards (S-02).
 *
 * **This module imports neither Astro's server-env module nor the Supabase client, by design.**
 * That env specifier only resolves inside Astro's build, so a generator that read the API key
 * itself could not be driven from the eval harness. The key, model, and effort arrive as
 * arguments — the endpoint supplies them from Astro's server env, `scripts/eval-cards.ts` from
 * `process.env`. Same reason it takes image *bytes* rather than a `source_id`: the endpoint
 * downloads from Storage, the eval script reads a local file.
 */

/** Total output-token budget. See the comment on the request below for why it is this large. */
const MAX_TOKENS = 8000;

export type GenerationErrorCode =
  /** Safety classifiers declined the request (`stop_reason: "refusal"`). */
  | "refusal"
  /** The response hit `max_tokens` — the JSON is cut off and must never be persisted. */
  | "truncated"
  /** The response did not validate against CardSetSchema. */
  | "schema-invalid"
  /** Card count far above the cap — treated as a hallucination, not trimmed. */
  | "hallucinated"
  /** Network / API failure, or any other error from the SDK. */
  | "upstream-failed";

export class GenerationError extends Error {
  readonly code: GenerationErrorCode;

  constructor(code: GenerationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GenerationError";
    this.code = code;
  }
}

export interface GenerateCardsInput {
  apiKey: string;
  /** Model id — an argument, not a module constant, so the eval harness can sweep it. */
  model: Anthropic.Model;
  /** Thinking depth / token spend. Swept by the eval harness; the endpoint pins one value. */
  effort: NonNullable<Anthropic.OutputConfig["effort"]>;
  /** Raw image bytes, base64-encoded, with no data-URL prefix. */
  imageBase64: string;
  mediaType: "image/png" | "image/jpeg";
  /** Canonical language values from src/lib/languages.ts. */
  learnedLanguage: string;
  knownLanguage: string;
  /** Passed through to the prompt builder; the eval harness sweeps it off. */
  includeOneCardDefault?: boolean;
}

export async function generateCards(input: GenerateCardsInput): Promise<CardSet> {
  const { apiKey, model, effort, imageBase64, mediaType, learnedLanguage, knownLanguage, includeOneCardDefault } =
    input;

  // Constructed per call, never at module scope: module-scope client reuse under Fluid Compute is
  // a standing hazard in this project (context/foundation/infrastructure.md).
  const client = new Anthropic({ apiKey });

  let response;
  try {
    response = await client.messages.parse({
      model,
      // Budgets adaptive thinking, not card volume. Typical output is one card — under 100
      // tokens — so almost all of this exists for thinking plus the pathological 15-card case.
      // The screenshot is deliberately NOT downscaled: the text is the payload, and resizing
      // makes it less legible.
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt({ learnedLanguage, knownLanguage, includeOneCardDefault }),
      output_config: {
        effort,
        format: zodOutputFormat(CardSetSchema),
      },
      // No `temperature` / `top_p` / `top_k`: non-default values are a 400 on this model family.
      // The replacement lever is `effort` plus a tighter prompt.
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageBase64 },
            },
            {
              type: "text",
              text: "Turn this screenshot into flashcards, following your instructions exactly.",
            },
          ],
        },
      ],
    });
  } catch (cause) {
    throw new GenerationError("upstream-failed", "The generation service call failed.", { cause });
  }

  // Checked BEFORE reading content. Truncated JSON is the one failure that looks like success to
  // a careless parser, and a refusal returns HTTP 200 with empty or partial content.
  if (response.stop_reason === "refusal") {
    throw new GenerationError("refusal", "The model declined to process this screenshot.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new GenerationError("truncated", "The response was cut off before it was complete.");
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new GenerationError("schema-invalid", "The response did not match the card schema.");
  }

  if (parsed.cards.length > HALLUCINATION_CARD_LIMIT) {
    throw new GenerationError(
      "hallucinated",
      `The model returned ${parsed.cards.length} cards, far beyond the ${MAX_CARDS}-card ceiling.`,
    );
  }

  // Server-side enforcement of the cap: the prompt states it, this guarantees it.
  return { ...parsed, cards: parsed.cards.slice(0, MAX_CARDS) };
}
