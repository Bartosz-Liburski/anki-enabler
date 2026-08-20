# Eval results — S-02 Phase 3

Run: 2026-07-31. 9 fixtures × 5 configurations = 45 model calls.
Reproduce with `npm run eval`. Raw output is not committed; the numbers below are the record.

## Sweep

| config | model | effort | keep-rate | over-gen | under-gen | exact count |
| --- | --- | --- | --- | --- | --- | --- |
| `sonnet-low` | `claude-sonnet-5` | low | **100.0%** | 0.0% | 0.0% | 9/9 |
| `sonnet-medium` | `claude-sonnet-5` | medium | **100.0%** | 0.0% | 0.0% | 9/9 |
| `sonnet-high` | `claude-sonnet-5` | high | **100.0%** | 0.0% | 0.0% | 9/9 |
| `opus-high` | `claude-opus-5` | high | **100.0%** | 0.0% | 0.0% | 9/9 |
| `sonnet-medium-no-onecard` | `claude-sonnet-5` | medium | **100.0%** | 0.0% | 0.0% | 9/9 |

Also identical across all five: `sourceHadTranslation` correct 9/9, and the zero-card fixture
returned an empty set with a usable `emptyReason` 1/1. No errors, no refusals, no truncation.
`extractionConfidence` was `high` on every fixture in every configuration.

## Verdict against the bar

The ≥ 75%-kept bar (`prd.md:36`) is cleared by a wide margin, and **count accuracy is perfect
alongside it** — so the keep-rate is not bought with quota-filling. The single-phrase fixtures each
returned exactly one card; the three-line transcript returned exactly three. Over-splitting, the
failure this slice was most exposed to, did not occur once in 45 calls.

## What this does NOT show

**The one-card-default ablation came out flat.** `sonnet-medium-no-onecard` scores identically to
`sonnet-medium` on every metric. On this fixture set the instruction's value is therefore
*unmeasured*, not *demonstrated* — the honest reading is that these sources are too easy to
separate the two prompts, not that the instruction is worthless.

Why the set is easy: eight of nine fixtures are Duolingo screens showing one utterance, where the
correct card count is obvious from the layout. Over-splitting is a risk on **dense** sources — a
lyrics page, a printed vocabulary list, an exercise page with several numbered items — and the set
contains none. The instruction stays in the production prompt: it costs a few tokens, the research
predicts the failure it guards against, and this eval does not contradict it.

**Follow-up worth doing before trusting the ablation either way:** add two or three dense fixtures
(a vocabulary list, a lyrics excerpt, a page with several exercises) and re-run
`npm run eval -- --only sonnet-medium-no-onecard` against `--only sonnet-medium`. That is also the
fixture shape most likely to move keep-rate off 100%, which makes it the more informative
addition to this set generally.

**Second gap:** the zero-card fixture is derived — the same Italian transcript labelled with
`learnedLanguage: "de"`. It grades the empty-state mechanism correctly, but a screenshot with no
foreign-language text at all (an English-only app screen, a photo without text) would exercise a
different path through the model's judgement.

## Effort decision carried into Phase 4

All three Sonnet 5 effort levels score identically here, so this data does not justify paying for
`high`. `low` is not chosen either: the fixture set is homogeneous and easy, and the research notes
`low` risks under-thinking on moderately complex sources — the eval cannot rule that in or out from
these nine images.

**Production default: `claude-sonnet-5` at effort `medium`.** Changing it later is a two-constant
edit in the generation endpoint; `opus-high` remains the documented escalation if real-world
sources turn out harder than this set.
