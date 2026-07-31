# S-02 — LLM selection research

**Change ID:** `generate-and-review-cards`
**Date:** 2026-07-30
**Method:** web research via Exa (search + fetch), anchored on vendor pricing pages where possible
**Question:** which model do we wire in to (a) read a screenshot, (b) produce translations, (c) emit Q/A flashcards — optimising for accuracy and price?

> Written in English to match the rest of `context/` (PRD, roadmap, infrastructure are English).

---

## 1. What the task actually is

Framing matters, because "pick an LLM" has a different answer depending on the workload shape. Ours:

| Property | Value | Source |
| --- | --- | --- |
| Input | 1 screenshot per generation, stored in Supabase Storage | `infrastructure.md:116`, `roadmap.md:91` |
| Image content | UI screenshots of language-learning apps (Duolingo-style), lyrics, exercise pages — **rendered/printed text, not handwriting** | `prd.md:22`, `prd.md:105` |
| Script | Whatever the user is learning. Latin-dominant, but nothing in the PRD restricts it | `prd.md:65` |
| Extra structure | Some sources already contain a translation — must be **extracted and reused**, not re-translated | `prd.md:107` |
| Output | Capped set of Q/A pairs, oriented learned → known | `prd.md:103-107`, FR-007 |
| Quality bar | ≥ 75% of generated cards kept, not discarded | `prd.md:36`, `prd.md:53` |
| Volume | Solo hobbyist MVP. Realistically tens–hundreds of generations/month | `prd.md:28` |
| Runtime | Vercel Node serverless, Fluid Compute, `maxDuration` 60 (300s ceiling on Hobby) | `infrastructure.md:17`, `infrastructure.md:130` |
| Language | TypeScript, Astro 6 SSR. No LLM SDK installed yet | `roadmap.md:58` |

**The single most important consequence:** this is a *one-shot vision + structured-extraction* task, not a reasoning task and not a high-volume pipeline. Two things follow.

### 1.1 Price is not the deciding axis

Modelled per generation: ~600 prompt tokens + 1 image + ~900 output tokens (15 cards × ~60 tokens), plus thinking tokens where the model bills them as output.

| Model | In / Out per MTok | Img tokens | Est. $/generation | $/mo @ 100 gen | $/mo @ 500 gen |
| --- | --- | --- | --- | --- | --- |
| `google/gemini-3.5-flash-lite` + thinking HIGH | $0.30 / $2.50 | ~258 | ~$0.022 | ~$2.20 | ~$11 |
| `google/gemini-3.5-flash-lite` no thinking | $0.30 / $2.50 | ~258 | ~$0.0025 | ~$0.25 | ~$1.25 |
| `openai/gpt-5-mini` | $0.25 / $2.00 | ~765 | ~$0.0021 | ~$0.21 | ~$1.05 |
| `anthropic/claude-haiku-4-5` | $1 / $5 | ~1,334 | ~$0.0064 | ~$0.64 | ~$3.20 |
| `google/gemini-3.6-flash` + thinking | $1.50 / $7.50 | ~258 | ~$0.066 | ~$6.60 | ~$33 |
| `anthropic/claude-sonnet-5` | $2 / $10 (→$3/$15 on 2026-09-01) | ~1,334 | ~$0.012 | ~$1.20 | ~$6 |

The entire realistic candidate set costs **under $10/month at MVP volume**. A 10× price difference between the cheapest and the reasonable-quality option is, in absolute terms, a few dollars. Optimising hard for price here buys nothing and risks the 75% bar — which is the one thing S-02 exists to prove (`roadmap.md:105`).

**Therefore: select on accuracy, cap on cost.**

### 1.2 Latency is not a risk either

Measured Gemini Flash-tier vision+thinking latency is ~6s per image ([Armenian OCR study](https://vahehovhannisyan.com/best-llm-for-armenian-ocr), 50 runs). Against `maxDuration: 60` that is a 10× margin. The `infrastructure.md` Fluid-Compute timeout footgun stays a real config risk, but it is not a *model choice* constraint — nothing in the candidate set needs the 300s ceiling.

---

## 2. Accuracy evidence

Four independent sources, weighted by how close their test is to our workload.

### 2.1 GlotOCR Bench — the strongest evidence (peer-reviewable, Apr 2026)

[arXiv 2604.12978](https://doi.org/10.48550/arxiv.2604.12978), 14 OCR systems across 158 scripts, metric Acc@5 (fraction of sentences with ≤5% character error).

| System | Latin | Mid-resource (Arabic, Cyrillic, Devanagari…) | Low-resource (148 scripts) | Mean |
| --- | --- | --- | --- | --- |
| **Gemini 3.1 Flash-Lite** | **95.3%** | **82.7%** | 7.7% | **61.9%** |
| dots.mocr (specialist) | 93.1% | 78.1% | 7.7% | 59.6% |
| Qwen3-VL-8B | 89.5% | 67.1% | 0.8% | 52.4% |
| GPT-4.1 | 83.2% | 66.7% | 1.6% | 50.5% |

Takeaways:
- A **Flash-Lite-tier Gemini beats specialist OCR models and a frontier OpenAI model** on text extraction. Cheap does not mean bad for this specific job.
- Latin is near-solved for everyone (>75% for all 14 systems). **On Latin-script sources the model choice barely matters.**
- Mid-resource scripts are where the spread opens up (82.7% vs 66.7% — a 16-point gap).
- Below that, everything collapses. If a user studies Georgian, Armenian, Khmer, or Amharic, **no model in 2026 works** — best result across the board is 7.7%. This is a product boundary, not a model-selection problem.
- Failure mode is *not silent*: models emit fluent text in the nearest script they know rather than refusing. Directly threatens FR "explanatory state, not a silent empty result."

### 2.2 Vision benchmark on real mobile screenshots (May 2026)

[Railwail](https://railwail.com/us/blog/claude-gpt-gemini-vision-benchmark), F1 on a 1,000-image set of real mobile-app screenshots — the closest published proxy for our input:

| Content type | Claude Opus 4.7 | GPT-5.4 | Gemini 3.1 Pro |
| --- | --- | --- | --- |
| Latin (English, German, Spanish) | 94.8% | 95.6% | **96.1%** |
| CJK | 88.3% | 89.7% | **92.4%** |
| Cyrillic | 92.1% | 93.5% | **94.8%** |
| Arabic / RTL | 84.7% | 87.2% | **90.6%** |
| Handwritten English | 78.4% | **82.1%** | 80.5% |

Same shape as GlotOCR: **Latin is a three-way tie (1.3 points); Gemini's lead only materialises off-Latin.**

Caveat worth recording — the *same article's* qualitative table rates **Claude best on "UI screenshots (mobile, web)"** (4.7 vs 4.6/4.5) and attributes it to Anthropic's Computer Use training. So: Gemini reads the *characters* better, Claude reportedly understands the *interface* better. Our task needs both (read the foreign phrase, and know which on-screen text is the exercise vs. chrome/buttons). This conflict is not resolvable from published benchmarks — it is exactly what the eval set in §5 must settle.

### 2.3 Temperature and thinking dominate model choice

Two findings that matter more than which vendor you pick.

**Temperature.** [Armenian OCR study](https://vahehovhannisyan.com/best-llm-for-armenian-ocr) (Apr 2026, n=50): `gemini-3-flash-preview` scored **100% at `temperature: 0`** and **78% at the default `temperature: 1.0`** — same model, same image. Errors at temp 1.0 were visually-similar-glyph confusions (`Պ↔Ղ`, `Ի↔Է`). The decoder was rolling dice on uncertain glyphs. **Set `temperature: 0`.** Free accuracy.

**Thinking tokens.** [Source Library](https://sourcelibrary.org/blog/confident-hallucinator) evaluated Gemini Flash / Flash-Lite / Pro across five scripts and found:

| Model | Default thinking tokens | Behaviour on hard images |
| --- | --- | --- |
| Gemini Flash | ~7,700 (on by default) | Clean reading |
| Gemini Flash-Lite | 0 | **Hallucinates** — 4–27× more text than the page contains |
| Gemini Pro | 0 | **Hallucinates**, worse than Flash, at 55× the cost |
| Flash-Lite + `thinkingLevel: HIGH` | ~7,700 | Fixed, matches Flash |

Their conclusion: *"The confident hallucinator is simply a model without thinking turned on… Model size does not fix hallucination."* Pro generated 16,400 characters from a page Flash read as 660.

This is the highest-severity finding in this document for S-02. A model that fabricates cards is worse than one that produces none: it silently destroys the ≥75%-kept bar, and it does so **with perfect run-to-run consistency**, so it survives casual manual testing. Two mandatory consequences:
1. **Enable thinking explicitly** on whichever model is chosen. Do not rely on defaults — they differ per tier and changed between versions.
2. **Add an output sanity check.** Cap card count server-side (FR-007 already requires this) *and* treat a wildly over-length model response as a failure, not a result.

### 2.4 The one direct negative signal on a candidate

In the same Armenian study, `claude-haiku-4-5` **ignored the transcription instruction entirely in 10/10 runs**, returning visual descriptions ("a man with a guitar") instead of text. `gpt-5-mini` and `gpt-5.4-mini` scored 0/40 combined on the stylized-font title. `gpt-5.4-mini` at `reasoning: low` ignored the instruction 70% of the time and needed `medium` (at 3.5× the cost) to comply.

Weight this carefully: it is n=10 on stylized Armenian poster art — far harder than a Duolingo screenshot, and a script in GlotOCR's collapsed low-resource tier. It is **not** evidence that Haiku fails on printed Latin text. It *is* evidence that instruction-following on vision tasks degrades unpredictably per model, and that a "describes instead of transcribes" failure is a real class we must detect.

---

## 3. Structured output — the integration risk

Generation must return schema-valid JSON (array of Q/A pairs). This turned out to have more sharp edges than the model choice.

- **AI SDK v6 changed the API.** `generateObject` is deprecated in favour of `generateText` + `Output.object()`. But [vercel/ai#12491](https://github.com/vercel/ai/issues/12491) shows `Output.object()` **does not request provider-level JSON mode** — it parses free-form text client-side. Benchmarked 20 runs, same prompt/model: `generateObject` 20/20, `Output.object()` 17/20 (even with `extractJsonMiddleware`). A ~15% silent failure rate on the core feature.
- **Anthropic adapter hangs on optional fields.** [vercel/ai#11503](https://github.com/vercel/ai/issues/11503): `@ai-sdk/anthropic` 3.0 hangs indefinitely on a Zod schema with 6+ optional fields (5 works, 6 doesn't). Workaround: `providerOptions: { anthropic: { structuredOutputMode: 'jsonTool' } }`.
- **Provider capability matrix** ([tracker, May 2026](https://blogs.abhipanseriya.dev/tools/ai-sdk-provider-support)): OpenAI, Anthropic, Google Generative AI, and Vercel AI Gateway all support tools + structured output + image input. Cohere does not do structured output at all. No constraint on our shortlist.

**Design consequence:** keep the card schema **flat and free of optional fields**.

```ts
z.object({
  cards: z.array(z.object({ front: z.string(), back: z.string() })).max(MAX_CARDS),
  sourceHadTranslation: z.boolean(),   // FR: reuse vs. produce translation
  extractionConfidence: z.enum(['high', 'low']),  // FR-003 low-confidence warning
})
```

`extractionConfidence` is not decoration — FR-003's guardrail ("surface a low-confidence warning when text extraction is uncertain") and the FR "explanatory state, not a silent empty result" both need a signal the model can set, and an empty `cards` array is a legitimate, expected outcome rather than an error.

---

## 4. Recommendation

### 4.1 Integrate through Vercel AI Gateway, not a single vendor SDK

This is the strongest architectural conclusion, and it is stronger than the model recommendation itself.

The plan-blocking unknown in `roadmap.md:103` is *"which LLM provider/model?"* — but §2.2 shows published benchmarks **cannot** answer it for Latin-script UI screenshots, because the candidates are within 1.3 points of each other and the two most relevant sources disagree about who wins. The answer has to come from measuring against real screenshots. So the architecture's job is to make swapping models cost nothing.

[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) fits exactly:

- **One `AI_GATEWAY_API_KEY`** instead of per-vendor keys — directly reduces the `infrastructure.md:100` secret-rotation surface.
- **No markup.** Provider list price, including with BYOK. Choosing the Gateway costs nothing versus going direct.
- **Model = a string slug** (`google/gemini-3.5-flash-lite`, `anthropic/claude-haiku-4-5`). Switching models is an env-var change, not a code change. A/B-ing three models against the eval set becomes trivial.
- **Automatic failover** to the same model on another provider during an outage.
- **Free tier credits** on a subset of models, with per-model rate limits — enough to run the eval before spending anything.
- Already on Vercel, so no new vendor relationship, and spend is visible in the same dashboard.

The one thing to verify at plan time: whether the chosen model is in the Gateway free-tier subset, and whether free-tier rate limits are workable for eval runs.

### 4.2 Model: start with `google/gemini-3.5-flash-lite`

| Setting | Value | Why |
| --- | --- | --- |
| Model | `google/gemini-3.5-flash-lite` | Best measured multilingual OCR of any system in GlotOCR (§2.1); floor-tier price at $0.30/$2.50; 1M context; ~0.7s base latency |
| `temperature` | `0` | +22pp accuracy on hard glyphs, free (§2.3) |
| thinking | **explicitly HIGH** | Flash-Lite defaults to zero thinking and hallucinates without it (§2.3). This is the difference between a working feature and a broken one |
| max output tokens | hard cap ≈ `MAX_CARDS × 80` | Enforces FR-007's card cap in the billing dimension, not just the parsing dimension |
| Image | resize to ≤1024px longest edge before send | Cuts image tokens; Gemini bills a flat ~258 tokens/image at standard tiers, so oversized uploads buy nothing |

**Comparators to run against the same eval set** (all reachable through the Gateway by changing one string):
- `anthropic/claude-haiku-4-5` — $1/$5. Rated best on UI-screenshot comprehension (§2.2), but carries the §2.4 "describes instead of transcribes" flag. Needs `structuredOutputMode: 'jsonTool'` (§3).
- `openai/gpt-5-mini` — $0.25/$2. Cheapest credible option, and the Armenian study found it *better* than the newer `gpt-5.4-mini` on transcription while being 5× cheaper. Newer ≠ better here.

**Escalation path if the 75% bar is missed:** `google/gemini-3.6-flash` ($1.50/$7.50, thinking on by default). At MVP volume that is ~$7/month — an acceptable price for clearing the bar S-02 exists to prove.

**Explicitly rejected:** the Pro/Opus/frontier tier. §2.3 found Gemini Pro *hallucinated worse* than Flash on hard images at 55× the cost, and the general-purpose comparisons put Claude Opus at ~$0.007–0.008/image against Gemini Flash-Lite's ~$0.0003. There is no evidence of a quality gain on this workload that would justify it.

### 4.3 Cost containment (satisfies the PRD's cost NFR)

`prd.md:99` requires rejecting oversized sources *before* generation runs. Layered:

1. **Upload gate** — reject images over the published size cap before storage (S-01 already owns this).
2. **Downscale before send** — ≤1024px longest edge.
3. **Hard `maxOutputTokens`** — sized from the card cap.
4. **Bounded thinking budget** — thinking bills as output on Gemini; leave it uncapped and a pathological image can cost 10× a normal one.
5. **Per-user generation counter** in Supabase. Steps 1–4 bound the cost of *one* call; only a counter bounds the cost of a loop. The [ankids write-up](https://qunfei.blog/2026/04/30/) records **$84 burned in one hour** from an async generation pipeline working exactly as designed. Worth one table column.

### 4.4 Privacy flag — do not ship on Gemini's free tier

Google's [pricing page](https://ai.google.dev/gemini-api/docs/pricing) states plainly for every free-tier row: **"Used to improve our products: Yes"** (Paid tier: No). User screenshots are private study material; the PRD commits to per-user isolation as a launch-gating NFR (`prd.md:98`).

The free tier is fine — and useful — for evaluating models against your own screenshots during S-02. **Move to the paid tier before any real user data flows.** At MVP volume that costs single-digit dollars per month.

---

## 5. What this research could not settle

**The eval set is the real blocker, and it is on the user.**

`roadmap.md:104` lists "how is the ≥75%-kept quality bar measured in practice?" as an open question owned by the user, marked non-blocking. Based on §2.2 that classification is too generous: the published benchmarks put the top three candidates within 1.3 points on Latin script and disagree on the winner for UI screenshots. **Model choice cannot be settled from public data — only from real screenshots.**

Concretely, to unblock:
- ~10 representative screenshots (the actual apps/material in use), covering: one with an in-source translation, one without, one that should legitimately yield zero cards.
- Hand-written expected output for each.
- Run all three candidates. Keep-rate against that set *is* the 75% metric.

That work is small — an afternoon — and it converts the biggest risk in S-02 from a guess into a measurement. Without it, any model choice in this document is an informed default, not a validated one.

Secondary items for `/10x-plan`:
- Verify `gemini-3.5-flash-lite` list price and free-tier membership on the Gateway model list at plan time (see §6).
- Decide the low-confidence UI treatment (FR-003) using `extractionConfidence`.
- Decide whether unsupported-script inputs (§2.1's collapsed tier) get an explicit "language not supported" state or fall through to the generic empty-result state.

---

## 6. Source reliability notes

Prices move and aggregator sites carry stale numbers — several found during this research contradicted each other and listed retired models as current. Confidence levels:

| Fact | Confidence | Basis |
| --- | --- | --- |
| Claude pricing (Haiku 4.5 $1/$5, Sonnet 5 $2/$10 → $3/$15 on 2026-09-01) | **High** | [Official Anthropic pricing docs](https://docs.claude.com/en/docs/about-claude/pricing) |
| OpenAI pricing (gpt-5-mini $0.25/$2, gpt-5.4-mini $0.75/$4.50) | **High** | [Official OpenAI pricing](https://platform.openai.com/docs/pricing) |
| Gemini 3.6 Flash $1.50/$7.50; free tier trains on your data | **High** | [Official Google pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Gemini 3.5 Flash-Lite $0.30/$2.50 | **Medium** | Vercel AI Gateway model list + secondary source; the fetched section of Google's official page did not include this row. **Re-verify before committing.** |
| ~258 tokens per image on Gemini, ~1,334 on Claude, ~765 on OpenAI | **Medium** | Multiple consistent aggregators; not confirmed against vendor docs. Affects cost estimates by <2× — does not change any ranking. |
| GlotOCR results | **High** | Peer-review-format paper with published methodology and per-script tables |
| Temperature / thinking findings | **Medium-high** | Two independent practitioner studies with published run counts (n=50, n=10–20) and reproducible configs. Small n, but the effect sizes (100% vs 78%; 660 vs 16,400 chars) are far larger than the noise. |
| "Claude best on UI screenshots" | **Low** | Single-source qualitative 1–5 rating, contradicted by the same article's own F1 table |

Vendor-published or self-published benchmarks were treated as marketing unless methodology and per-task numbers were shown.
