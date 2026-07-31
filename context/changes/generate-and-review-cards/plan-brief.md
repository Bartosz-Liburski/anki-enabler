# Generate Flashcards From a Source and Review Them — Plan Brief

> Full plan: `context/changes/generate-and-review-cards/plan.md`
> Research (Anthropic surface): `context/changes/generate-and-review-cards/research-claude.md`
> Research (cross-vendor): `context/changes/generate-and-review-cards/research-exa-ai.md`

## What & Why

Roadmap slice S-02, the north star. Turn a stored screenshot into Q/A flashcards oriented
learned → known through one Claude vision call with structured output, then let the user review
the result on a single screen and discard the weak cards. **One card is the expected output** —
most screenshots capture a single phrase worth learning; several cards appear only when the
source genuinely carries several distinct items, and the model decides that. This is the slice
that proves — or disproves — the product's core assumption, that ≥ 75% of generated cards are
worth keeping (`prd.md:36`).

## Starting Point

S-01 stores screenshots privately in Supabase Storage, tagged with a learned/known language pair.
`flashcards` exists but is bare: `id`, `user_id`, `source_id`, `created_at`, with per-user RLS and
a `source_id` cascade — its own comment defers `front`, `back`, and `kept/discarded` to this
slice. There is no LLM SDK, no API key in the env schema, and — because S-01 deliberately renders
no source list — **no route that reaches a saved source at all**.

## Desired End State

After uploading a screenshot the user lands on that source's page, clicks generate, and gets the
cards that source warrants — usually one — with the front in the language being learned and the
back in the language they know. They toggle discard per card and save once; the decisions survive
a reload. Re-generating
asks for confirmation and then replaces the set. A screenshot with nothing usable in it explains
why instead of showing an empty screen, and a low-confidence extraction says so.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Integration path | Anthropic SDK directly | `messages.parse()` enforces the schema provider-side, avoiding the ~15% silent parse failures measured for the AI SDK's `Output.object()`. | Plan |
| Default model | `claude-sonnet-5`, env-swappable | Same high-resolution vision tier and structured-output support as Opus 5 at ~40% of the cost. | Plan |
| Accuracy ceiling | Opus 5 row in the eval sweep | Sonnet 5 isn't the ceiling, so a missed bar there can't distinguish model from hypothesis. | Research |
| Eval set | A phase in this plan | Both research docs conclude the 75% bar is unmeasurable without labelled examples, against the roadmap's `Block: no`. | Research |
| Discard model | `discarded boolean default false` | Matches FR-010's "kept = not discarded" and preserves the keep-rate denominator. | Plan |
| Re-generation | Replace after explicit confirmation | Honours FR-008 while protecting review work already invested. | Plan |
| Call shape | Synchronous POST | One image is single-digit seconds against a 60 s budget; a job table adds states without removing the timeout. | Plan |
| Empty / confidence state | Columns on `sources` | The explanation has to survive a reload, or it is indistinguishable from a never-generated source. | Plan |
| Cards per source | One by default; several only for genuinely multi-item sources | A stated cap reads as a quota — padding to 15 tanks the kept-rate while every card still looks correct alone. | Plan |
| Card cap | 15 as a safety ceiling, enforced in prompt + `max_tokens` + server-side | Claude ignores array constraints and the SDK strips them silently, so a schema cap bills for 30 cards then throws. | Research |
| No sampling params | Omit `temperature` entirely | Non-default values are a 400 on Sonnet 5 / Opus 5, so the `temperature: 0` advice doesn't transfer. | Research |
| Screenshot resolution | Send unresized | The text *is* the payload; a phone screenshot already fits the 2576 px high-res tier. | Research |
| Review UX | Whole set, one save | Literal reading of FR-009's single review screen; one transaction instead of 15 requests. | Plan |
| `zod` added | Yes, for the LLM boundary only | External structured data must be validated; hand-rolled validation stays for forms. | Plan |

## Scope

**In scope:** additive migration (card content, discard flag, generation state); Anthropic SDK +
`ANTHROPIC_API_KEY`; generator module (schema, prompt, vision call, cap enforcement); eval harness
with labelled fixtures; synchronous generation endpoint with replace-after-confirm; review screen
with per-card discard, empty state, low-confidence warning, and re-generation; retargeting S-01's
success redirect so a new source is reachable.

**Out of scope:** CSV export (S-03); source/deck browsing and deletion (S-04); plain-text sources
(S-05); card editing (PRD non-goal); versioned generation history; per-user rate limiting;
streaming; crop/zoom tool loops; multi-provider abstraction; a test framework.

## Architecture / Approach

```
upload (S-01) ──▶ /sources/{id}
                      │  POST /api/sources/[id]/generate
                      ▼
        download private object ──▶ generateCards({apiKey, model, effort, imageBase64, pair})
                                            │  messages.parse() + zodOutputFormat
                                            ▼
                        generate ▶ then delete old cards ▶ insert new ▶ stamp source state
                      │
                      ▼  POST /api/sources/[id]/review
              review screen ──▶ discarded flags for the whole set, one save
```

The generator imports neither `astro:env/server` nor the Supabase client — key, model, and image
bytes are arguments. That seam is what lets the eval harness drive it from plain Node, and it is
why the eval phase can run before any endpoint exists.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer | Card content + discard flag; generation-state columns | `NOT NULL` without defaults is safe only while `flashcards` is empty |
| 2. Generator module | SDK, key, schema, prompt, capped vision call | `max_tokens` budgets thinking too — a tight value truncates silently |
| 3. Eval harness | Keep-rate **and count accuracy** per model and effort against labelled fixtures | Blocks on user-supplied screenshots; may reveal the bar is unreachable |
| 4. Generation endpoint | Generate / replace-after-confirm / record outcome | Fluid Compute regression breaks this endpoint in production only |
| 5. Review screen | Single-screen keep/discard, empty + low-confidence states | Un-discard depends on "absent from the submitted set" semantics |

**Prerequisites:** S-01 merged; an Anthropic API key; ~10 real screenshots labelled by hand with
their **expected card count** (including one with an in-source translation, one without, one that
should yield zero cards, several ordinary single-card ones, and at least one text-heavy source
that should yield several); Fluid Compute confirmed enabled on the Vercel project.
**Estimated effort:** ~4–6 sessions across 5 phases, plus one afternoon of the user's own time to
assemble the eval fixtures.

## Open Risks & Assumptions

- **The quality bar may not be reachable.** If neither Sonnet 5 nor Opus 5 clears 75% on real
  screenshots, the finding is about the product hypothesis, not the implementation — and that is
  exactly what S-02 exists to surface.
- **Over-generation is the failure mode this slice is most exposed to.** A model that pads a
  one-phrase screenshot into eight defensible-but-pointless cards attacks the kept-rate directly
  while every card still looks correct in isolation. The one-card-default prompt line and the
  eval harness's count-accuracy metric are the defences; if they don't hold, the fix is prompt
  work, not a lower cap.
- **Hallucination is silent and repeatable.** A model without adequate thinking can invent
  volumes of text consistently enough to pass casual manual testing; the card cap and the eval
  harness are the only defences.
- **Sonnet 5's introductory pricing ends 2026-08-31**, after which input/output rates rise from
  $2/$10 to $3/$15 per MTok. Size any budget on the standard rate.
- **Pricing figures in the research carry Medium confidence** — `research-claude.md:80` notes the
  live pricing page 404'd during research. The current API reference corroborates the Opus 5 and
  Sonnet 5 rows used here, but re-verify before committing to a budget.
- **Regeneration has no rate ceiling.** At $0.017–0.048 per call this is dollars rather than
  hundreds, but nothing in the system stops repeated clicks.
- **Non-Latin scripts are a product boundary, not a model-selection problem.** GlotOCR puts every
  system below 8% on 148 low-resource scripts, so a user studying Georgian or Amharic cannot be
  served by any 2026 model.

## Success Criteria (Summary)

- A user can go upload → generate → review → keep, and their keep/discard decisions survive a
  reload.
- The eval harness prints a keep-rate for the shipped configuration, so the ≥ 75% bar is a
  measured number rather than an impression.
- A source that yields nothing explains why, and still explains it after a page refresh.
