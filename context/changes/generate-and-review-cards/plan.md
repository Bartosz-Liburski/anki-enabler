# Generate Flashcards From a Source and Review Them — Implementation Plan

## Overview

Roadmap slice **S-02**, the north star. Turn a stored screenshot source into Q/A flashcards
through **one Claude vision call with structured output**, then let the user review the result on
a single screen and discard the weak cards. Re-generation replaces the set. A source that yields
nothing shows an **explanatory state**, not a silent empty result.

**The expected output is one card.** A typical screenshot captures a single phrase or exchange
worth learning, and that is one flashcard. Several cards are produced only when the source
genuinely carries several distinct learnable items — a lyrics excerpt, a transcript, a dense
exercise page — and the model decides that from the content. The 15-card cap is a **safety
ceiling against runaway output, not a target**; see Critical Implementation Details for why that
distinction is load-bearing rather than cosmetic.

This slice introduces the project's entire LLM surface — SDK, API key, prompt, output schema,
model selection, timeout budget — and its first multi-record write. It also builds the **eval
harness** that makes the ≥ 75%-kept bar (`prd.md:36`) measurable, because that bar is the one
metric the MVP is judged on and no amount of documentation can substitute for labelled examples.

## Current State Analysis

- **`flashcards` is bare.** F-01's migration
  (`supabase/migrations/20260723162258_init_sources_flashcards.sql:46-51`) created
  `public.flashcards` with only `id`, `user_id`, `source_id`, `created_at`, a per-user
  owner-all RLS policy, and `source_id ... on delete cascade` (which is what already
  guarantees FR-006 for S-04). Its own comment states the feature columns — *"front, back,
  kept/discarded"* — are added by later slices via **additive** migrations. Do not edit it.
- **S-01 handed over exactly what generation consumes.** `sources` now carries `type`,
  `image_path`, `learned_language`, `known_language`
  (`supabase/migrations/20260726105652_add_screenshot_source_fields.sql`). The image lives in
  the **private** `screenshots` bucket at `{user_id}/{source_id}.{ext}`, gated by
  owner-path Storage RLS — so there is no public URL, and bytes must be fetched through the
  user's own session.
- **The LLM surface does not exist.** No LLM SDK and no `zod` in `package.json`.
  `astro.config.mjs` declares only `SUPABASE_URL` / `SUPABASE_KEY` in its `env.schema`, so a
  third secret has to be added there before any code can read it.
- **The timeout budget is already set but fragile.** `astro.config.mjs` sets
  `adapter: vercel({ maxDuration: 60 })`. `infrastructure.md:77` records the footgun: the 300 s
  Hobby ceiling depends on Fluid Compute staying enabled, and a config regression silently
  reverts to a 10 s cap that fails **in production only**.
- **No route reaches a stored source.** S-01 deliberately renders no source list (browse is
  S-04's, per FR-005), and its endpoint redirects to `/dashboard?...`. There is therefore **no
  path from the UI to a saved source**, which would leave S-02 unreachable.
- **Established conventions to follow.** Endpoints are `export const POST: APIRoute`, read
  `context.request.formData()`, build a **per-request** Supabase client, and respond with
  `context.redirect(...)` — no JSON API exists (`src/pages/api/sources.ts`). Outcome codes live
  in one typed module (`src/lib/source-errors.ts`). Forms are real `<form method="POST">` with a
  `client:load` island doing hand-rolled validation. Missing configuration surfaces as a banner
  via `src/lib/config-status.ts`.
- **No test runner exists.** Project checks are `npx astro sync && npx astro check && npm run
  lint`, plus `npm run build`.

## Desired End State

A signed-in user who has added a screenshot source can:

- Land on that source's page directly after upload and trigger generation with one click.
- Get the cards that source actually warrants, oriented learned → known, reusing a translation
  already present in the screenshot when there is one and producing one when there isn't. For a
  typical screenshot that is **one card**; a text-heavy source may yield several, up to a ceiling
  of 15.
- Review the whole set on one screen, toggle **discard** per card, and save once. The kept cards
  are those not discarded — which is what S-03 will export.
- Re-generate, replacing the set, with a confirmation step when cards would be lost.
- On a source that yields nothing, read **why** — and see that explanation again after a page
  reload, not an empty screen.
- See a warning when the model reports low confidence in its text extraction (FR-003's
  guardrail, deferred to this slice by S-01's plan).
- Never reach another user's cards (per-user RLS carried from F-01, unchanged here).

**How to verify:** generate from an ordinary screenshot → one card appears, front in the learned
language, back in the known one; generate from a text-heavy source → several cards, one per
distinct item; discard some, save, reload → the same cards stay discarded;
re-generate → confirmation appears, then a fresh set replaces the old; point at a screenshot
with no foreign-language content → an explanation renders and survives a reload; run the eval
harness → it prints a keep-rate against the labelled fixtures.

### Key Discoveries:

- **The card cap cannot live in the schema.** Claude's structured outputs support no array
  constraints, and the SDKs **strip unsupported constraints from the schema sent to the API and
  validate them client-side**. A `z.array(...).max(15)` therefore compiles, tells the model
  nothing, generates 30 cards, bills all 30 output tokens, and only then throws
  (`research-claude.md:96-102`). The cap must be enforced in the prompt, in `max_tokens`, and by
  truncating server-side.
- **`max_tokens` caps thinking *plus* response text.** Adaptive thinking is on by default on
  Sonnet 5 when `thinking` is omitted, so a `max_tokens` sized tightly around the card JSON
  truncates mid-answer once thinking runs.
- **Non-default `temperature` / `top_p` / `top_k` return a 400** on Sonnet 5 and Opus 5. The
  `temperature: 0` recommendation in `research-exa-ai.md:95` does not transfer to Claude; the
  replacement lever is `output_config.effort` plus a tighter prompt, and it is behavioural, not
  a seed — nothing on this API gives byte-identical repeats.
- **Do not downscale the screenshot.** The generic advice to resize for cost is wrong here: the
  text *is* the payload, and the Vision docs warn resizing makes text less legible. A phone
  screenshot (1179×2556) sits under Sonnet 5's high-resolution 2576 px long edge and is passed
  through unresized at ~3,956 visual tokens (`research-claude.md:47-59`).
- **Vision cost is the whole cost story, and prompt caching is not the lever.** The image
  dominates the request; the cacheable part is the system prompt, and Sonnet 5's minimum
  cacheable prefix is 1024 tokens. Caching is worth adding for latency, not for the bill.
- **Citations are incompatible with `output_config.format`** (returns a 400). Per-card
  provenance, if ever wanted, has to be a schema field.
- **Privacy clears cleanly on this provider.** The Vision docs state Anthropic does not train on
  uploaded images and that image uploads are ephemeral — which satisfies the launch-gating
  privacy NFR without the paid-tier caveat `research-exa-ai.md:189-193` flags for Gemini's free
  tier, where the pricing page states training use is "Yes" on every free row.
- **Two corrections to the research docs.** Haiku 4.5 has a **200K** context and 64K max output
  (not 1M), and its prompt-cache minimum is 4096 tokens — so a normal system prompt silently
  never caches there. Both docs imply otherwise.

## What We're NOT Doing

- **No CSV export** (S-03, FR-012) — this slice ends at kept cards in the database.
- **No source or deck browsing, no deletion** (S-04, FR-005/FR-006/FR-011). The route added
  here reaches **one** source by id; there is no list. F-01's cascade already covers deletion
  when S-04 arrives.
- **No plain-text sources** (S-05, FR-004) — generation reads an image; the `type` column stays
  `'screenshot'`.
- **No flashcard editing** (PRD Non-Goal) — discard is the only curation action.
- **No versioned generation history.** Re-generation replaces the set; there is no
  `generation_number` and no `generations` table. The eval harness supplies prompt-comparison
  data instead.
- **No per-user generation counter / rate limit.** Generation is synchronous and one click is
  one call, so there is no loop to run away; the cost guard is the card cap plus `max_tokens`.
  Revisit if regeneration spam ever shows up in the bill.
- **No streaming.** At ~700 output tokens there is nothing to stream; the SDK's streaming
  guidance starts above ~16,000 `max_tokens`.
- **No crop/zoom tool loop.** `research-claude.md:113` notes tools beat raising effort as an
  accuracy lever on Opus 5 — but that is a second call shape and belongs after the eval set
  says OCR misses are actually the failure mode.
- **No multi-provider abstraction.** The generator is Anthropic-specific by decision; a
  cross-vendor comparison stays a research question, not a production dependency.
- **No new test framework.** Verification is `astro check` + `lint` + `build`, the eval harness,
  and the manual steps.

## Implementation Approach

One additive migration gives `flashcards` its content columns plus a `discarded` flag, and
`sources` three nullable columns recording the last generation's outcome. A provider-agnostic-at-
the-seam generator module takes an API key, a model id, image bytes, and the language pair, and
returns a validated card set via `client.messages.parse()` — deliberately **not** reading
`astro:env/server` itself, so the eval harness can call it from plain Node. The eval harness runs
next, against labelled fixtures, and is the gate on whether the quality hypothesis holds. Only
then does a synchronous `POST /api/sources/[id]/generate` wire the generator to Supabase —
fetching the private object, generating, replacing the card set, and recording generation state —
followed by a `/sources/[id]` review screen whose island collects discard decisions and saves
them in one POST. S-01's success redirect is retargeted at that page so the flow is upload →
generate → review with no list in between.

## Critical Implementation Details

- **The generator module must not import `astro:env/server`.** That specifier only resolves
  inside Astro's build, so a generator that reads the key itself cannot be called from the eval
  script. Pass `apiKey`, `model`, and `effort` in as arguments: the endpoint supplies them from
  `astro:env/server`, the eval script from `process.env`. Same reason the module takes image
  **bytes** rather than a `source_id` — the endpoint downloads from Supabase Storage, the eval
  script reads a local file.
- **Generate before deleting.** Re-generation replaces the set, but if the delete runs first and
  the model call then fails, the user is left with nothing — their previous cards *and* their
  review work gone, with no way back. Call the model first; only once a valid card set is in
  hand delete the old rows and insert the new ones.
- **Ordering inside the replace is load-bearing too.** Delete the source's existing cards and
  insert the new set before updating `sources`' generation-state columns, so a failure can never
  leave `last_generated_at` pointing at a set that was never written.
- **A stated cap reads as a quota unless you say otherwise.** Tell a model "at most 15 cards"
  and it will happily find fifteen things to say about a screenshot containing one phrase. Every
  padded card is individually defensible and collectively worthless — and because the kept-rate
  denominator counts them, quota-filling **attacks the ≥ 75% bar directly** while every single
  card still looks correct in isolation. The prompt must lead with *one card unless the source
  carries genuinely distinct items*, and the eval harness must score card **count**
  appropriateness, not only card quality.
- **`max_tokens` must budget thinking, not card volume.** Typical output is one card — under 100
  tokens — so the budget exists almost entirely for adaptive thinking plus the pathological
  15-card case. Start at **8000** and treat `stop_reason === "max_tokens"` as a failure to
  surface, never as a result to persist. Truncated JSON is the one failure that looks like
  success to a careless parser.
- **Hallucination is silent and repeatable.** `research-exa-ai.md:97-110` measured a model
  producing 16,400 characters from a page containing 660, consistently enough to survive casual
  manual testing. Treat a wildly over-length response as an error, not a result — which is what
  the server-side card-count truncation and the eval harness together are for.

---

## Phase 1: Data Layer — Card Columns and Generation State

### Overview

One additive migration adds the columns S-02 writes: card content and the discard flag on
`flashcards`, and the last-generation outcome on `sources`. Types are regenerated. F-01's RLS
policies and the `source_id` cascade are untouched.

### Changes Required:

#### 1. Additive migration: `flashcards` content + `sources` generation state

**File**: `supabase/migrations/<timestamp>_add_flashcard_fields.sql` (new)

**Intent**: Give `flashcards` the columns a generated card needs and the flag that expresses
FR-010's keep/discard, and give `sources` somewhere to record why a generation produced nothing.

**Contract**:
- `alter table public.flashcards add column`:
  - `front text not null` — the prompt side, in the source's `learned_language`
  - `back text not null` — the answer side, in the source's `known_language`
  - `discarded boolean not null default false` — kept is the complement, per FR-010
- `alter table public.sources add column` (all nullable; `null` means *never generated*, which is
  what distinguishes a fresh source from one that legitimately produced zero cards):
  - `last_generated_at timestamptz`
  - `generation_note text` — the model's `emptyReason`, stored only when it is non-empty
  - `extraction_confidence text` with `check (extraction_confidence in ('high','low'))`
- Column comments explaining the kept-is-the-complement rule and the null-means-never-generated
  convention. No down path (forward-only, `infrastructure.md:99`).
- `front` / `back` are `NOT NULL` with no default, which is safe **only** because `flashcards`
  is empty — nothing has ever written to it. Same reasoning as S-01's `learned_language`.
- Do not add an index: `flashcards_source_id_idx` from F-01 already covers the review query.

#### 2. Regenerate `database.types.ts`

**File**: `src/db/database.types.ts` (regenerated)

**Intent**: Reflect the new columns so inserts and updates type-check.

**Contract**: Output of `supabase gen types typescript` for the linked project. `flashcards`
Row/Insert/Update gain `front`, `back`, `discarded`; `sources` gain `last_generated_at`,
`generation_note`, `extraction_confidence`. No hand-edits.

### Success Criteria:

#### Automated Verification:

- Migration file exists: `ls supabase/migrations/*_add_flashcard_fields.sql`
- Migration applies cleanly: `supabase db push`
- Types reflect new columns: `grep -q discarded src/db/database.types.ts`
- Type checking passes: `npx astro sync && npx astro check`
- Linting passes: `npm run lint`

#### Manual Verification:

- In Studio, `flashcards` shows `front`, `back`, `discarded` with `discarded` defaulting to false
- `sources` shows the three nullable generation-state columns with the confidence check constraint
- F-01's `flashcards_owner_all` policy and the `source_id` cascade are unchanged

**Implementation Note**: After Phase 1's automated checks pass, pause for manual confirmation
before proceeding to Phase 2.

---

## Phase 2: Generator Module

### Overview

Add the LLM dependency and secret, then build the one module that turns image bytes plus a
language pair into a validated card set. It is deliberately free of Astro and Supabase imports
so the eval harness in Phase 3 can drive it directly.

### Changes Required:

#### 1. Dependencies and the API key

**File**: `package.json`, `astro.config.mjs`, `src/lib/config-status.ts`

**Intent**: Install the SDK and schema library, declare the secret so `astro:env/server` exposes
it, and surface a missing key as a banner rather than a runtime failure.

**Contract**: Add `@anthropic-ai/sdk` and `zod` to dependencies. In `astro.config.mjs`'s
`env.schema`, add `ANTHROPIC_API_KEY: envField.string({ context: "server", access: "secret",
optional: true })` — `optional: true` matching the existing Supabase entries so the app still
builds without it. Add an `ANTHROPIC_API_KEY` entry to `configStatuses` following the existing
shape (the message string is Polish there — match it).

> `zod` is a deliberate departure from the repo's hand-rolled-validation convention, which stays
> in force for forms. The LLM boundary is the one place an external system returns structured
> data that must not be trusted, and `zodOutputFormat` is what enforces the schema at the
> provider *and* re-checks the constraints the API silently strips.

#### 2. Card schema

**File**: `src/lib/llm/card-schema.ts` (new)

**Intent**: One typed description of what a generation returns, shaped to survive Claude's
structured-output limitations.

**Contract**: A `zod` object with `cards` (array of `{ front: string, back: string }`),
`sourceHadTranslation: boolean`, `extractionConfidence: enum(['high','low'])`, and
`emptyReason: string`. **Flat, and with no optional fields** — `emptyReason` is a required string
that is empty when cards exist, because optional fields are the shape most likely to trip schema
handling and a required-but-empty string costs one token. **No `.max()` on `cards`** — see
Key Discoveries; the cap is enforced elsewhere. Also export `MAX_CARDS = 15`, named and commented
as a **safety ceiling, not an expected or target count** — a future reader who mistakes it for a
target will re-introduce the quota-filling failure the prompt is written to avoid.

#### 3. Prompt

**File**: `src/lib/llm/prompt.ts` (new)

**Intent**: Build the system prompt carrying the learning direction, the **one-card default**,
the reuse-or-produce translation rule, and the explicit permission to return zero cards.

**Contract**: A function taking the learned/known language pair (canonical values from
`src/lib/languages.ts`, rendered to display names via `languageLabel`) and returning the system
prompt string. It must state, in this order of emphasis:

- **How many cards.** One card is the normal answer: most screenshots capture a single phrase,
  sentence, or exchange, and that is one flashcard. Produce more **only** when the source
  contains genuinely distinct learnable items — separate lines of lyrics, separate exchanges in a
  transcript, separate vocabulary entries on an exercise page — with one card per item. Never
  split a single phrase into fragments, never restate the same phrase from a different angle, and
  never add cards to fill space. If in doubt between one card and several, return one. The
  15-card ceiling exists to bound runaway output and is **not** a target to approach.
- `front` is in the learned language and `back` in the known one.
- Reuse a translation already visible in the screenshot rather than re-translating it, and set
  `sourceHadTranslation` accordingly.
- Return an **empty `cards` array with a populated `emptyReason`** when the image contains no
  usable foreign-language material, rather than inventing cards.
- Set `extractionConfidence` to `'low'` when the text was hard to read.

Kept stable and free of per-request interpolation beyond the language pair, so it remains
cacheable. The one-card default is the single highest-leverage line in this prompt — the eval
harness in Phase 3 measures whether it holds, and Phase 3's sweep should include a prompt
variant without it as the comparison, so the instruction's value is demonstrated rather than
assumed.

#### 4. Generator

**File**: `src/lib/llm/generate-cards.ts` (new)

**Intent**: Make the single Claude vision call and return a validated, capped card set.

**Contract**: Exports an async function taking `{ apiKey, model, effort, imageBase64, mediaType,
learnedLanguage, knownLanguage }` and returning the parsed schema object. Steps:
- Construct `new Anthropic({ apiKey })` **per call** — never at module scope (`infrastructure.md:76`
  makes module-scope client reuse under Fluid Compute a standing hazard in this project).
- `client.messages.parse()` with `output_config: { format: zodOutputFormat(CardSetSchema),
  effort }`, `max_tokens: 8000`, and a user message containing an `image` block
  (`source: { type: 'base64', media_type, data }`) followed by a short text instruction.
- **Send no `temperature` / `top_p` / `top_k`** — non-default values are a 400 on this model.
- Check `stop_reason` **before** reading content: treat `'refusal'` and `'max_tokens'` as
  failures with distinct error codes, never as results.
- Truncate `cards` to `MAX_CARDS` before returning, and reject a response whose card count
  exceeds the cap by a wide margin as a hallucination rather than trimming it silently.
- Model id and effort are **arguments, not module constants**, so the eval harness can sweep them.

**Contract note — the seam that matters**: this module imports neither `astro:env/server` nor
`@/lib/supabase`. That is what makes Phase 3 possible; see Critical Implementation Details.

### Success Criteria:

#### Automated Verification:

- Dependencies installed: `grep -q '@anthropic-ai/sdk' package.json && grep -q '"zod"' package.json`
- Module files exist: `ls src/lib/llm/{card-schema,prompt,generate-cards}.ts`
- Generator is free of Astro/Supabase imports: `! grep -rE "astro:env|lib/supabase" src/lib/llm/`
- Type checking passes: `npx astro sync && npx astro check`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- `ANTHROPIC_API_KEY` is set locally and in Vercel (Production + Preview)
- With the key absent, the app still builds and the config banner names the missing key
- A one-off call against a real screenshot returns schema-valid JSON with plausible cards

**Implementation Note**: After Phase 2's automated checks pass, pause for manual confirmation
that a real call succeeds before proceeding to Phase 3.

---

## Phase 3: Eval Harness

### Overview

Make the ≥ 75%-kept bar measurable. Ten labelled screenshots plus a script that calls the
generator directly and reports keep-rate per model and effort level. This phase is the
instrument the whole slice exists to read — and it is the one phase that **blocks on
user-supplied material**.

### Changes Required:

#### 1. Labelled fixtures

**File**: `context/changes/generate-and-review-cards/eval/` (new)

**Intent**: A small, honest sample of the material actually in use, with hand-written expected
output, so quality becomes a number instead of an impression.

**Contract**: ~10 real screenshots plus, per screenshot, a JSON file recording the language pair,
the expected cards, and the **expected card count**. The set **must** include: one source with a
translation already visible in the image, one without, one that should legitimately yield **zero**
cards, several ordinary single-phrase screenshots that should each yield **exactly one** card,
and at least one genuinely text-heavy source (lyrics excerpt or transcript) that should yield
several. Owner: the user — no agent can supply this.

The single-card majority is not padding in the fixture set: over-splitting is the failure mode
this slice is most exposed to, and it cannot be detected by a harness whose every fixture expects
many cards.

#### 2. Eval script

**File**: `scripts/eval-cards.ts` (new)

**Intent**: Run every fixture through the generator across a matrix of models and effort levels
and print the resulting keep-rate.

**Contract**: A script reading `ANTHROPIC_API_KEY` from `process.env`, iterating the fixtures,
calling `generateCards` directly (base64 from the local file), and comparing produced cards to
expected ones. Reports per configuration:

- **Keep-rate** — cards matching expectation over cards generated. The ≥ 75% bar.
- **Count accuracy** — produced count vs expected count per fixture, summarised as an
  over-generation rate (fixtures where the model returned more cards than warranted) and an
  under-generation rate. A configuration that scores well on keep-rate while over-generating is
  **not** passing; report the two side by side so the trade cannot be hidden.
- `sourceHadTranslation` correctness, and whether the zero-card fixture returned an empty set
  with a usable reason.

Sweeps at minimum `claude-sonnet-5` at effort `low` / `medium` / `high`, plus one `claude-opus-5`
run as the accuracy ceiling, plus one run with the one-card-default line removed from the prompt
to quantify what that instruction is worth. Add a `devDependency` capable of running a TypeScript
file directly and an `npm run eval` script.

> **Why the Opus 5 row matters.** The chosen production default is Sonnet 5, which is *not* the
> accuracy ceiling. If the bar is missed on Sonnet 5, that alone does not tell you whether the
> model or the product hypothesis is at fault — the Opus 5 run is what separates the two, and it
> must happen before anyone concludes S-02's hypothesis failed.

### Success Criteria:

#### Automated Verification:

- Fixtures present, including the three required cases: `ls context/changes/generate-and-review-cards/eval/`
- Script exists and is wired: `ls scripts/eval-cards.ts && grep -q '"eval"' package.json`
- Type checking passes: `npx astro sync && npx astro check`
- Linting passes: `npm run lint`
- The harness runs to completion and prints a keep-rate per configuration: `npm run eval`

#### Manual Verification:

- Keep-rate on `claude-sonnet-5` is recorded, and compared against the ≥ 75% bar
- **Count accuracy is recorded alongside it** — single-phrase fixtures return exactly one card,
  and the text-heavy fixture returns several
- If Sonnet 5 misses the bar, the `claude-opus-5` row is recorded before drawing any conclusion
  about the product hypothesis
- The zero-card fixture returns an empty set **with** a usable `emptyReason`, not invented cards
- The no-one-card-default prompt variant is run, and the difference recorded
- A chosen effort level is decided and written into the endpoint's configuration in Phase 4

**Implementation Note**: This phase pauses for the user to supply and label the screenshots.
Its result decides the model and effort the rest of the slice ships with — and, if the bar is
missed on both models, whether to continue at all.

---

## Phase 4: Generation Endpoint

### Overview

Wire the generator to Supabase behind a synchronous endpoint: fetch the private object,
generate, replace the card set, record the outcome. Also retarget S-01's success redirect so a
freshly uploaded source is reachable.

### Changes Required:

#### 1. Outcome codes for generation

**File**: `src/lib/source-errors.ts`

**Intent**: Extend the existing typed outcome vocabulary rather than introducing a second one.

**Contract**: Add generation codes to the `SourceErrorCode` union and the message map —
covering at minimum: source not found, generation service unconfigured, the model refused, the
response was truncated, the response failed schema validation, the upstream call failed, and
confirmation is required before replacing an existing set. Add a success code carrying the
generated card count and a distinct signal for the legitimate zero-card outcome.

#### 2. Generation endpoint

**File**: `src/pages/api/sources/[id]/generate.ts` (new)

**Intent**: Turn one stored source into a fresh card set for the current user.

**Contract**: `export const POST: APIRoute`, following the existing redirect-based convention.
Steps, in order:
- Build the per-request client; if it or `context.locals.user` is absent → redirect `/auth/signin`.
  (`/api/*` is not covered by the middleware guard.)
- Read `context.params.id`; select that `sources` row. RLS scopes the select to the owner, so a
  missing row covers both "does not exist" and "belongs to someone else" — redirect with the
  not-found code either way, and **do not** distinguish them in the message.
- If `ANTHROPIC_API_KEY` is absent → redirect with the unconfigured code.
- Count the source's existing cards. If any exist and the form does not carry an explicit
  `confirm=replace`, redirect back with the confirmation-required code **without calling the
  model** — no spend on a request the user may abandon.
- Download the object from the `screenshots` bucket via
  `supabase.storage.from('screenshots').download(source.image_path)`, convert to base64, and
  derive `mediaType` from the stored path's extension (the endpoint wrote that extension, so it
  is trustworthy).
- Call `generateCards` with the key and the model/effort from Phase 3's result.
- **Only after a valid set is in hand**: delete the source's existing `flashcards` rows, insert
  the new ones (`{ user_id, source_id, front, back }`, `discarded` defaulting false), then update
  the source's `last_generated_at`, `generation_note` (the `emptyReason`, or null when cards
  exist), and `extraction_confidence`. See Critical Implementation Details for why this order.
- Redirect to `/sources/{id}` with the success, zero-card, or error signal.

#### 3. Retarget S-01's success redirect

**File**: `src/pages/api/sources.ts`

**Intent**: Make a newly created source reachable, closing the gap that would otherwise leave
S-02 unreachable from the UI.

**Contract**: On successful create, redirect to `/sources/{id}` instead of the dashboard,
carrying the existing success signal. The language-pair params stay on the dashboard's own
redirects so the "add another screenshot to this pair" loop from S-01 is preserved — the review
page links back to the dashboard with the pair intact.

### Success Criteria:

#### Automated Verification:

- Endpoint exists: `ls src/pages/api/sources/[id]/generate.ts`
- Type checking passes: `npx astro sync && npx astro check`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- Generating on an ordinary single-phrase screenshot inserts **one** `flashcards` row with
  `front` in the learned language and `back` in the known one, and stamps `last_generated_at`
- Generating on a text-heavy source inserts several rows, one per distinct item
- Generating a second time without confirmation changes nothing and costs nothing
- Generating with confirmation replaces the set — old rows gone, new rows present
- A source belonging to another user cannot be generated (redirects as not-found)
- An unauthenticated POST redirects to `/auth/signin`
- With `ANTHROPIC_API_KEY` unset, the endpoint fails cleanly with a message and writes nothing
- A forced upstream failure leaves the previous card set intact

**Implementation Note**: After Phase 4's automated checks pass, pause for manual confirmation of
the generate / replace / failure behaviour before proceeding to Phase 5.

---

## Phase 5: Review Screen

### Overview

The single review screen from FR-009: the whole card set at once, discard per card, one save.
Plus the explanatory empty state, the low-confidence warning, and re-generation with
confirmation.

### Changes Required:

#### 1. Source review page

**File**: `src/pages/sources/[id].astro` (new)

**Intent**: Render one source, its cards, and the outcome of its last generation.

**Contract**: Reads `Astro.params.id`, builds a per-request client, and selects the source plus
its `flashcards` ordered by `created_at`. A missing row (RLS-scoped) renders a not-found state
rather than throwing. Renders, per state: **never generated** (`last_generated_at` is null) → a
generate call to action; **cards present** → the review island; **generated but zero cards** →
the `generation_note` as the explanatory state, which is exactly what surviving a reload
requires; `extraction_confidence === 'low'` → a warning banner alongside the cards. Surfaces the
success / error signals from Phase 4's redirect via `sourceErrorMessage`, reusing the banner
styles from `dashboard.astro`. Shows the learning direction and a link back to the dashboard
carrying that pair. Route protection: add `/sources` to `PROTECTED_ROUTES` in
`src/middleware.ts`, keeping the pair-recall block scoped to `/dashboard` as it is now.

#### 2. Review island

**File**: `src/components/cards/ReviewCardList.tsx` (new)

**Intent**: Collect discard decisions for the whole set and submit them once.

**Contract**: A `client:load` island rendering a real `<form method="POST"
action="/api/sources/{id}/review">`. Each card is a row showing `front` and `back` with a
checkbox named `discard` whose value is the card id, pre-checked from the row's current
`discarded` value — so the browser's native submission carries the full decision set with no JS,
consistent with the progressive-enhancement pattern S-01 established. A running count of kept
cards, and `SubmitButton` for the pending state. No per-card request.

#### 3. Review persistence endpoint

**File**: `src/pages/api/sources/[id]/review.ts` (new)

**Intent**: Persist the whole set's keep/discard decisions in one call.

**Contract**: `export const POST: APIRoute`. Auth-guards as above, reads
`formData.getAll('discard')` as the discarded id set, and applies it scoped to the source: the
listed ids become `discarded = true`, the rest of that source's cards `discarded = false` —
because an unchecked box submits nothing, so "not in the list" is the only way an un-discard is
expressed. Both updates are scoped by `source_id` **and** rely on RLS for ownership. Redirects
back to `/sources/{id}` with a saved signal.

#### 4. Regeneration control

**File**: `src/components/cards/RegenerateForm.tsx` (new)

**Intent**: Let the user replace the set, without losing review work by accident.

**Contract**: A small island posting to the generate endpoint. When the source already has
cards, `handleSubmit` requires an explicit in-UI confirmation before allowing the native POST,
and the submitted form carries `confirm=replace` — matching the endpoint's server-side guard, so
the protection holds even if the client is bypassed.

### Success Criteria:

#### Automated Verification:

- Page and components exist: `ls src/pages/sources/[id].astro src/components/cards/{ReviewCardList,RegenerateForm}.tsx`
- Review endpoint exists: `ls src/pages/api/sources/[id]/review.ts`
- Type checking passes: `npx astro sync && npx astro check`
- Linting passes: `npm run lint`
- Production build passes: `npm run build`

#### Manual Verification:

- The review screen shows the whole set on one screen with a discard toggle per card
- Discarding some cards and saving persists; a reload shows the same cards still discarded
- Un-checking a previously discarded card and saving restores it to kept
- A source that yielded zero cards shows its explanation, and **still shows it after a reload**
- A low-confidence generation shows the warning alongside its cards
- Re-generate asks for confirmation, then replaces the set
- `/sources/{id}` for another user's source is not reachable
- No regression: the S-01 upload flow still works and the dashboard pair loop is intact

**Implementation Note**: After Phase 5 passes, S-02 is complete and S-03 (CSV export) plus S-04
(browse/manage) are unblocked.

---

## Testing Strategy

### Unit Tests:

- None — no test runner is introduced (consistent with F-01 and S-01). The eval harness in
  Phase 3 is this slice's automated quality instrument, and it measures model output rather than
  code paths.

### Integration Tests:

- The eval harness is the closest thing to an integration test: it drives the real generator
  against real screenshots and asserts on the produced card sets.
- The end-to-end manual flow (upload → generate → review → reload) is the integration scenario.
  F-01's `supabase/tests/isolation.sql` continues to guard table-level RLS.

### Manual Testing Steps:

1. Apply the migration; confirm the new columns and the confidence check in Studio.
2. Set `ANTHROPIC_API_KEY`; confirm the config banner disappears.
3. Upload a screenshot; confirm you land on `/sources/{id}` rather than the dashboard.
4. Generate from an ordinary single-phrase screenshot; confirm **exactly one** card with the
   correct language orientation and a stamped `last_generated_at`. Repeat on a text-heavy source;
   confirm several cards, one per distinct item.
5. Discard two cards, save, reload; confirm the decisions persisted. Un-discard one, save,
   reload; confirm it came back.
6. Re-generate; confirm the confirmation step, then that the set was replaced.
7. Generate from a screenshot with no foreign-language content; confirm an explanation renders
   and survives a reload.
8. Sign in as a second user; confirm `/sources/{id}` for the first user's source is unreachable.
9. Unset `ANTHROPIC_API_KEY` and generate; confirm a clean failure that writes nothing.
10. Run `npm run eval`; record keep-rate **and count accuracy** per configuration against the
    ≥ 75% bar.

## Performance Considerations

One image plus a typical one-card response — well under 100 output tokens — lands in single-digit
seconds, far inside `maxDuration: 60`, so the latency budget is not tight. The research docs
modelled ~700 output tokens on a 15-card assumption; with one card as the norm, output is a
rounding error against the image and the per-generation cost sits at the bottom of the range
those tables give. The real risk is the **Fluid Compute regression** from
`infrastructure.md:77`: if it is disabled, Hobby silently reverts to a 10 s cap and this endpoint
starts timing out **in production only**. Verify Fluid Compute is enabled on the project as part
of Phase 4's manual gate.

Cost per generation is dominated by the image (~3,956 visual tokens for a phone screenshot),
which is why the screenshot is sent unresized and why prompt caching is not the lever here.
`sources_user_id_idx` and `flashcards_source_id_idx` from F-01 cover every query this slice adds.

## Migration Notes

Forward-only and additive (`infrastructure.md:99`) — no down path. `flashcards.front` / `back`
are `NOT NULL` without defaults, which is safe only because the table is empty; a populated table
would need a backfill first. `sources`' three new columns are nullable by design: `null` in
`last_generated_at` is what distinguishes "never generated" from "generated and legitimately
empty", and the review screen branches on exactly that. S-03 reads `discarded = false` to select
kept cards; S-04's delete cascades through `source_id` without further work.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-02, lines 94-105)
- PRD: `context/foundation/prd.md` FR-007..FR-010, US-01 (lines 46-57), NFR (line 99), the
  ≥ 75%-kept bar (line 36)
- Model research (Anthropic surface): `context/changes/generate-and-review-cards/research-claude.md`
- Model research (cross-vendor): `context/changes/generate-and-review-cards/research-exa-ai.md`
- Infra: `context/foundation/infrastructure.md` (Fluid Compute footgun line 77, per-request
  client line 76, forward-only migrations line 99, orchestration-only functions line 116)
- Prerequisite: `context/changes/add-screenshot-source/plan.md` (S-01 — image path, language
  pair, and the FR-003 warning deferred to this slice)
- Existing migration (do not edit): `supabase/migrations/20260723162258_init_sources_flashcards.sql`
- Endpoint template: `src/pages/api/sources.ts`; outcome codes: `src/lib/source-errors.ts`;
  island + banner patterns: `src/components/sources/AddSourceForm.tsx`, `src/pages/dashboard.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data Layer — Card Columns and Generation State

#### Automated

- [x] 1.1 Migration file exists — 6559bbd
- [x] 1.2 Migration applies cleanly (`supabase db push`) — 6559bbd
- [x] 1.3 Types reflect new columns (`grep discarded`) — 6559bbd
- [x] 1.4 Type checking passes (`astro sync && astro check`) — 6559bbd
- [x] 1.5 Linting passes (`npm run lint`) — 6559bbd

#### Manual

- [x] 1.6 `flashcards` shows `front`, `back`, `discarded` with the false default in Studio — 6559bbd
- [x] 1.7 `sources` shows the three nullable generation-state columns with the confidence check — 6559bbd
- [x] 1.8 F-01's `flashcards_owner_all` policy and `source_id` cascade unchanged — 6559bbd

### Phase 2: Generator Module

#### Automated

- [x] 2.1 Dependencies installed (`@anthropic-ai/sdk`, `zod`)
- [x] 2.2 Module files exist (`card-schema`, `prompt`, `generate-cards`)
- [x] 2.3 Generator free of Astro/Supabase imports
- [x] 2.4 Type checking passes (`astro sync && astro check`)
- [x] 2.5 Linting passes (`npm run lint`)
- [x] 2.6 Production build passes (`npm run build`)

#### Manual

- [ ] 2.7 `ANTHROPIC_API_KEY` set locally and in Vercel (Production + Preview)
- [x] 2.8 App builds without the key and the config banner names it
- [x] 2.9 A one-off call against a real screenshot returns schema-valid cards

### Phase 3: Eval Harness

#### Automated

- [ ] 3.1 Fixtures present: in-source-translation, no-translation, zero-card, several single-card, one text-heavy
- [ ] 3.2 Script exists and `npm run eval` is wired
- [ ] 3.3 Type checking passes (`astro sync && astro check`)
- [ ] 3.4 Linting passes (`npm run lint`)
- [ ] 3.5 Harness runs to completion and prints keep-rate **and count accuracy** per configuration (`npm run eval`)

#### Manual

- [ ] 3.6 Keep-rate on `claude-sonnet-5` recorded and compared against the ≥ 75% bar
- [ ] 3.7 Count accuracy recorded: single-phrase fixtures return exactly one card, text-heavy returns several
- [ ] 3.8 `claude-opus-5` row recorded if Sonnet 5 missed the bar, before any hypothesis call
- [ ] 3.9 Zero-card fixture returns an empty set with a usable `emptyReason`
- [ ] 3.10 No-one-card-default prompt variant run and the difference recorded
- [ ] 3.11 Effort level chosen and carried into Phase 4

### Phase 4: Generation Endpoint

#### Automated

- [ ] 4.1 Endpoint exists (`api/sources/[id]/generate.ts`)
- [ ] 4.2 Type checking passes (`astro sync && astro check`)
- [ ] 4.3 Linting passes (`npm run lint`)
- [ ] 4.4 Production build passes (`npm run build`)

#### Manual

- [ ] 4.5 Single-phrase screenshot inserts exactly one correctly oriented card and stamps `last_generated_at`
- [ ] 4.6 Text-heavy source inserts several cards, one per distinct item
- [ ] 4.7 Second generation without confirmation changes nothing and costs nothing
- [ ] 4.8 Generation with confirmation replaces the set
- [ ] 4.9 Another user's source cannot be generated
- [ ] 4.10 Unauthenticated POST redirects to `/auth/signin`
- [ ] 4.11 Missing `ANTHROPIC_API_KEY` fails cleanly and writes nothing
- [ ] 4.12 Forced upstream failure leaves the previous card set intact
- [ ] 4.13 Fluid Compute confirmed enabled on the Vercel project

### Phase 5: Review Screen

#### Automated

- [ ] 5.1 Page and components exist (`sources/[id].astro`, `ReviewCardList`, `RegenerateForm`)
- [ ] 5.2 Review endpoint exists (`api/sources/[id]/review.ts`)
- [ ] 5.3 Type checking passes (`astro sync && astro check`)
- [ ] 5.4 Linting passes (`npm run lint`)
- [ ] 5.5 Production build passes (`npm run build`)

#### Manual

- [ ] 5.6 Whole set renders on one screen with a discard toggle per card
- [ ] 5.7 Discard decisions persist across a reload
- [ ] 5.8 Un-discarding a card and saving restores it to kept
- [ ] 5.9 Zero-card source shows its explanation, and still shows it after a reload
- [ ] 5.10 Low-confidence generation shows the warning alongside its cards
- [ ] 5.11 Re-generate asks for confirmation, then replaces the set
- [ ] 5.12 Another user's `/sources/{id}` is unreachable
- [ ] 5.13 No regression: S-01 upload flow and the dashboard pair loop still work
