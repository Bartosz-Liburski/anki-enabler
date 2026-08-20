# S-02 research — Claude/Anthropic model selection

**Change:** `generate-and-review-cards` (S-02, north star)
**Question:** which Claude model to wire in for screenshot → translation → Q/A flashcard, weighing accuracy against price
**Date:** 2026-07-30
**Scope:** Anthropic first-party API only. The multi-provider comparison (Gemini / OpenAI / Claude) lives in [`research.md`](./research.md) alongside this file. Read both before deciding; this one goes deeper on the Claude surface and corrects two recommendations from `research.md` that do not transfer to Claude.

Written in English to match the rest of `context/`.

---

## 1. What S-02 actually asks the model to do

From `roadmap.md:94-104` and `prd.md` FR-002/003/007/008/009/010:

| Property | Value | Consequence for model choice |
| --- | --- | --- |
| Input | one screenshot of a language-app exercise, lyrics, or transcript | vision is mandatory, and it is **text-in-image**, not scene understanding |
| Direction | per-source learned → known language pair (FR-002) | passed as prompt context, not a model capability |
| Translation | reuse one present in the source, else produce it | needs the model to *decide* which case it is — this is the reasoning part |
| Output | Q/A card array, capped count (FR-007) | structured output, hard schema |
| Empty case | explanatory state, not silent empty (roadmap.md:96) | model must be able to return zero cards *and* say why |
| Quality bar | ≥ 75% of cards kept | the only metric that matters; everything below serves it |
| Cost | NFR: input size cap / cost bound | per-generation cost must be predictable, not just cheap |

Shape: **one multimodal request, structured output, no agent loop.** Per the skill's own tiering that is the "Single LLM call" tier — no tool runner, no Managed Agents. S-02 should stay a single `messages.create` behind one Astro API route.

---

## 2. Vision cost is the whole cost story

Confirmed from the [Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision.md), fetched 2026-07-30.

Claude bills images in **visual tokens**, one per 28×28 px patch:

```
visual_tokens = ceil(width / 28) × ceil(height / 28)
```

Two resolution tiers, and the split lands exactly on our candidate set:

| Tier | Models | Max long edge | Max visual tokens |
| --- | --- | --- | --- |
| High-resolution | **Claude 4.7 and later** — Opus 5, Sonnet 5, Opus 4.8 | 2576 px | 4784 |
| Standard | everything older — **Haiku 4.5** | 1568 px | 1568 |

Worked for our actual input:

| Screenshot | High-res tier (Opus 5 / Sonnet 5) | Standard tier (Haiku 4.5) |
| --- | --- | --- |
| Phone, 1179×2556 | not resized → **3,956 tokens** | downscaled to 723×1568 → **~1,456 tokens** |
| Desktop, 1920×1080 | not resized → **2,691 tokens** | downscaled to 1456×819 → **1,560 tokens** |

**This is the finding that drives everything else.** A phone screenshot is ~4,000 input tokens on the high-res tier and is by far the largest term in the request. The system prompt (~800 tokens) and the output (~700 tokens of card JSON) are rounding errors next to it.

Two consequences:

- **Prompt caching is not the cost lever here.** The cacheable part is the system prompt; the image is unique per request and uncacheable. Caching an 800-token system prompt saves under a tenth of a cent per call. Worth adding for latency, not for the bill. (Also note the minimum cacheable prefix: 512 tokens on Opus 5, 1024 on Sonnet 5, **4096 on Haiku 4.5** — an 800-token system prompt silently will not cache on Haiku at all, with no error, just `cache_creation_input_tokens: 0`.)
- **Do not downsample screenshots.** The generic advice is to downsample to control image-token cost. It is wrong for this product: the text *is* the payload, and the Vision docs warn that resizing "might make text less legible" and that heavy JPEG compression "can make text difficult to read." A phone screenshot already sits under the 2576 px cap and is passed through unresized. Send it native.

---

## 3. Cost per generation, measured not guessed

Model: one phone screenshot (3,956 visual tokens high-res / 1,456 standard), ~900 tokens of system + user text, 15 cards out (~700 output tokens), plus thinking where it is on by default.

| Model | $/MTok in / out | Thinking | Input tok | Output tok | **$/generation** | **$/100 generations** |
| --- | --- | --- | --- | --- | --- | --- |
| Opus 5 | 5 / 25 | on (default) | 4,856 | ~2,200 | **$0.079** | $7.90 |
| Opus 5 | 5 / 25 | off (effort ≤ high) | 4,856 | ~700 | **$0.042** | $4.20 |
| Sonnet 5 (intro) | 2 / 10 | on (default) | 4,856 | ~2,200 | **$0.032** | $3.20 |
| Sonnet 5 (intro) | 2 / 10 | off | 4,856 | ~700 | **$0.017** | $1.70 |
| Sonnet 5 (standard) | 3 / 15 | on | 4,856 | ~2,200 | **$0.048** | $4.80 |
| Haiku 4.5 | 1 / 5 | off (default) | 2,356 | ~700 | **$0.006** | $0.60 |

Sonnet 5's introductory $2/$10 runs **through 2026-08-31**, then reverts to $3/$15. A plan built on intro pricing gets ~50% more expensive in a month — size the budget on the standard rate.

Even the most expensive row is under $10 per hundred generations. **At MVP volume, price does not decide this.** It becomes a real constraint only at multi-thousand-generation scale, and by then the eval set from §6 will tell you whether a cheaper tier holds the 75% bar.

> Pricing confidence: Opus 5 at $5/MTok input and Haiku 4.5 at $1/MTok input are corroborated directly by the Vision docs' own worked cost examples. The remaining figures come from the skill's cached model table (cached 2026-06-24); the live pricing page 404'd on fetch. **Re-verify output prices and the Sonnet 5 intro end date before committing to a budget.**

---

## 4. Two recommendations from `research.md` that do NOT transfer to Claude

`research.md` researched Gemini/OpenAI and landed on two specific settings. Both are wrong on Claude, and one of them will hard-fail.

### 4.1 `temperature: 0` returns a 400

`research.md` recommends `temperature: 0` for deterministic OCR, citing a 100%-vs-78% accuracy measurement. **`temperature`, `top_p`, and `top_k` are removed on Opus 5, Sonnet 5, Opus 4.8, Opus 4.7, and Fable 5 — sending any of them returns a 400.** Non-default sampling params are rejected outright.

The Claude replacement for "be deterministic" is `output_config: {effort: "low"}` plus a tighter prompt. Note that this is a *behavioral* lever, not a sampling seed — it constrains how much the model explores, it does not make output reproducible. Nothing on the Claude API gives byte-identical repeat output, and `temperature: 0` never did either on models that accepted it.

`temperature` **is** still accepted on Haiku 4.5 (it is a pre-4.6 model). That is one point in Haiku's favour if determinism turns out to matter empirically — but it is also the model with the weaker vision tier, so the two pull opposite ways.

### 4.2 The card-count cap cannot live in the schema

`research.md` proposes `z.array(card).max(MAX_CARDS)`. Claude's structured outputs do **not** support array constraints. From the skill's structured-output reference, the unsupported list includes recursive schemas, numeric constraints (`minimum`/`maximum`/`multipleOf`), string constraints (`minLength`/`maxLength`), and complex array constraints; `additionalProperties: false` is required on every object.

The Python and TypeScript SDKs handle this by **stripping unsupported constraints from the schema sent to the API and validating them client-side**. So `.max(15)` compiles and appears to work — but the model was never told about the limit, generated 30 cards, you paid for all 30 output tokens, and then the SDK throws on validation. Silent-until-expensive.

Enforce the cap in three places instead: state it in the prompt, bound it with `max_tokens`, and truncate server-side before persisting.

---

## 5. Recommendation

### Default: `claude-opus-5`

This is the highest-accuracy option and the one to build against first. Concretely for S-02:

- **High-resolution vision** (2576 px, 4784 visual tokens) — the tier that matters for dense screenshot text.
- **Vision guidance is "give it tools, not more thinking":** on Opus 5, letting the model crop and re-examine a region is a markedly more cost-effective accuracy lever than raising effort. If the first eval round shows OCR misses on small text, add a crop/zoom tool before you touch `effort`.
- **Structured outputs supported** (Opus 5, Sonnet 5, Haiku 4.5, Opus 4.8, Fable 5 — note Sonnet 4.6 is *not* on that list, so it is not a fallback).
- **Effort ladder `low` → `max`.** For a single-shot extraction, start at `medium`/`low` and sweep — the guidance is explicit that `low` and `medium` are unusually strong on this model and are the primary cost lever, and that effort defaults carried over from another model are usually wrong.

### The cost decision is yours, and here is the data to make it

`claude-sonnet-5` costs roughly **40% of Opus 5** per generation and sits in the same high-resolution vision tier, with the same structured-output support and the same `low`–`max` effort ladder. `claude-haiku-4-5` costs roughly **8%** of Opus 5 but drops to the standard vision tier — a phone screenshot gets downscaled from 2556 px to 1568 px before the model ever sees it, which is precisely the degradation the Vision docs warn about for small text.

I am not picking the cheaper tier for you. My read of the tradeoff:

- **Opus 5** — build and evaluate here. It sets the accuracy ceiling, so a failure to clear 75% here means the *product hypothesis* is wrong, not the model choice. That is exactly the question S-02 exists to answer.
- **Sonnet 5** — the likely production model. Once the eval set exists, run it against Sonnet 5; if the kept-rate holds, take the ~60% saving.
- **Haiku 4.5** — only with eval evidence on real screenshots. The downscale is a genuine risk to the one thing that must work, and it is the only candidate that cannot cache a normal-sized system prompt.

Because model choice is a single string, structure the code so switching is a config change: read the model ID from an env var, keep the schema and prompt identical across tiers, and re-run the eval set per model.

### Not recommended

- **`claude-fable-5`** — $10/$50, twice Opus 5, for long-horizon agentic reasoning. S-02 is a one-shot extraction. Wrong shape, wrong price.
- **Advisor tool** (cheap executor + capable advisor) — designed for planning *during* long generation. A single extraction call has no mid-generation planning to advise on.
- **Batch API** (50% off) — up to 24h latency. Generation is interactive (user hits "generate" and waits). Possibly useful later for bulk regeneration after a prompt change, not for S-02.
- **Managed Agents** — no agent loop needed. Adds an agent object, an environment, a session, and an SSE stream to a problem that is one HTTP request.

---

## 6. Implementation notes for `/10x-plan`

Things that will bite during S-02 if not planned for.

**Thinking is on by default on Opus 5 and Sonnet 5, and `max_tokens` caps thinking *plus* response text together.** A `max_tokens` sized tightly around the card JSON will truncate mid-answer once thinking runs. Size it as `MAX_CARDS × 80 + thinking headroom`, or disable thinking — but note `thinking: {type: "disabled"}` is only accepted at effort `high` or below on Opus 5; pairing it with `xhigh`/`max` returns a 400, and the check is per request.

**Do not disable thinking casually on Opus 5.** With thinking off it can write a tool call into visible text instead of emitting a `tool_use` block — the turn succeeds, the call never runs, no error is raised — and it can leak `<thinking>` tags into the response. Prefer thinking on at `low`/`medium` effort, which gets most of the token saving anyway.

**Handle `stop_reason: "refusal"` before reading `content`.** Opus 5's safety classifiers can decline a request and return HTTP 200 with an empty `content` array. Code that reads `content[0].text` unconditionally will throw. Opt into server-side fallbacks by default — `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"`, which routes by refusal category and needs no maintained model list.

**Structured output shape** — flat, no optional fields, `additionalProperties: false`:

```ts
const CardSet = z.object({
  cards: z.array(z.object({
    front: z.string(),  // learned language
    back: z.string(),   // known language
  })),
  sourceHadTranslation: z.boolean(),          // FR: reuse vs. produce
  extractionConfidence: z.enum(["high", "low"]), // FR-003 low-confidence warning
  emptyReason: z.string(),                    // roadmap.md:96 explanatory state
});
```

`emptyReason` is a plain required string (empty when cards exist) rather than an optional field — optional fields are the shape most likely to trip schema handling, and a required-but-empty string costs one token.

**Citations are incompatible with `output_config.format`** — combining them returns a 400. If per-card provenance ("this came from this line of the source") is ever wanted, it has to be a schema field, not the citations feature.

**Image transport.** Images already land in Supabase Storage per `infrastructure.md`, so the function stays orchestration-only. Options: base64 inline (simplest, 10 MB per-image cap, 32 MB request cap on the Claude API) or a `url` source pointing at a Supabase signed URL. Prefer base64 — it avoids handing a third party a URL into your storage bucket. The Files API is beta and aimed at re-used images; a screenshot is read once, so it adds a beta dependency for nothing. Either way the PRD's input size cap NFR should be set below 10 MB.

**Privacy.** The Vision docs state plainly: *"Anthropic does not use uploaded images to train models"*, and *"Image uploads are ephemeral and not stored beyond the duration of the API request."* This clears the PRD's no-cross-user-visibility NFR without the paid-tier caveat that `research.md` flagged for Gemini's free tier, where the pricing page states training use is "Yes" on every free row. If the privacy NFR is treated as launch-gating, this is a substantive point in Claude's favour that pure price comparison misses.

**Vercel timeout.** One image + one structured response should land in single-digit seconds — far inside the planned `maxDuration: 60`. Watch the config-regression footgun from `infrastructure.md` (a silent revert to the 10s cap, prod-only), but the latency budget itself is not tight. Streaming is not needed at ~700 output tokens; the skill's streaming guidance kicks in above ~16,000 `max_tokens`.

---

## 7. What this research still cannot settle

Same conclusion as `research.md`, and worth repeating because nothing here changes it:

**The eval set is the blocker, not the model choice.** Ten real screenshots — one with an in-source translation, one without, one that should yield zero cards — with hand-written expected output. An afternoon of work. Without it, "Opus 5 vs Sonnet 5 vs Haiku 4.5" is an informed default rather than a measured decision, and the ≥ 75%-kept bar in `prd.md:36` cannot be evaluated at all.

`roadmap.md:104` marks the 75%-bar question as **Block: no**. I disagree, for the same reason as in `research.md`: S-02 is declared the north star *because* it proves the quality bar, and the bar is unmeasurable without labelled examples. The eval set is not a nice-to-have downstream of S-02 — it is the instrument S-02 is built to read.

What the eval set decides that no amount of documentation can:

1. Whether Haiku 4.5's downscale actually costs accuracy on your screenshots, or whether the text is large enough that it doesn't.
2. Which effort level holds the bar — the primary cost lever on Opus 5 and Sonnet 5.
3. Whether thinking-on is buying anything, or is pure output-token spend on a task this constrained.
4. Whether crop/zoom tooling beats raising effort (the Vision guidance says it should; your screenshots decide).

---

## 8. Source reliability

| Claim | Source | Confidence |
| --- | --- | --- |
| Visual-token formula, tier table, per-size token counts | Vision docs, fetched 2026-07-30 | **High** — primary, fetched today |
| Anthropic does not train on uploaded images; uploads ephemeral | Vision docs FAQ | **High** — primary |
| Opus 5 $5/MTok in, Haiku 4.5 $1/MTok in | Vision docs worked examples | **High** — corroborated in prose |
| Sonnet 5 $3/$15, intro $2/$10 to 2026-08-31; Opus 5 $25/MTok out; Haiku 4.5 $5/MTok out | Skill model table, cached 2026-06-24 | **Medium** — live pricing page 404'd; **re-verify before budgeting** |
| `temperature`/`top_p`/`top_k` return 400 on Opus 5 / Sonnet 5 | Skill API reference | **High** — stated repeatedly and consistently |
| Structured-output schema limits (no array/string/numeric constraints; SDK strips + validates client-side) | Skill structured-outputs reference | **High** |
| Thinking-on default and `max_tokens` covering thinking + text on Opus 5 | Skill migration guide | **High** |
| Haiku 4.5 is standard vision tier | Inferred — Vision docs say high-res is "Claude 4.7 and later"; Haiku 4.5 predates it and is absent from the high-res list | **Medium-High** — inference from an explicit rule, not an explicit row. Verify with `count_tokens` against a real screenshot |
| Per-generation cost figures in §3 | Computed here from the token formula + prices above | **Medium** — arithmetic is sound; input assumptions (15 cards, ~800-token system prompt, ~1,500 thinking tokens) are estimates. Re-measure with `messages.count_tokens` once the prompt exists |
