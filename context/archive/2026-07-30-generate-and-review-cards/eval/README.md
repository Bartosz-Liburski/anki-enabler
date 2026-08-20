# Eval fixtures (S-02, Phase 3)

Labelled screenshots the eval harness (`npm run eval`, `scripts/eval-cards.ts`) grades generation
against. This is the instrument that turns the ≥ 75%-kept quality bar (`prd.md:36`) into a number
instead of an impression — **no agent can supply this material; it has to be real screenshots of
the kind actually in use.**

## Format

One image plus one `.json` label file per fixture. The label's basename is the fixture id used in
the harness output; the image is named explicitly inside it, so the same image can be reused with
a different language pair.

```json
{
  "image": "benvenuto.png",
  "learnedLanguage": "it",
  "knownLanguage": "en",
  "expectedCardCount": 1,
  "expectedCards": [{ "front": "Benvenuto qui", "back": "Welcome here" }],
  "sourceHadTranslation": true,
  "note": "Google Translate screenshot — the English is already on screen."
}
```

| Field | Meaning |
| --- | --- |
| `image` | Filename in this directory. `.png`, `.jpg`, or `.jpeg`. |
| `learnedLanguage` / `knownLanguage` | Canonical values from `src/lib/languages.ts` (`it`, `en`, `pl`, …). |
| `expectedCardCount` | How many cards this source **genuinely warrants**. Must equal `expectedCards.length` — the harness refuses to run if they disagree. |
| `expectedCards` | The cards a good generation produces. `front` in the learned language, `back` in the known one. Each card may carry `backAlternatives: string[]` — other equally-correct wordings of the answer side. |
| `sourceHadTranslation` | `true` when a translation is already visible in the image. |
| `note` | Optional, for humans. Ignored by the harness. |

Comparison is case- and punctuation-insensitive but **keeps diacritics** — in a language-learning
card they are part of the answer, so folding them would score a wrong card as correct.

`backAlternatives` matters most on fixtures where the source carries no translation: the model
writes its own English, and "I like writing a book" / "I like to write a book" are both right.
Without alternatives a correct card scores as a miss and keep-rate measures phrasing luck. It
deliberately does **not** loosen `front` — the prompt side is read off the image, so it has one
right answer.

A card whose `front` matches but whose `back` matches none of the accepted wordings is reported
separately rather than scored as a failure. Read those lines: if the produced answer is also
correct, add it to `backAlternatives` rather than treating it as a defect.

## Required mix

Roughly 10 fixtures. The set **must** include:

- **Several ordinary single-phrase screenshots**, each with `expectedCardCount: 1`. This is the
  majority of the set and it is not padding: over-splitting is the failure mode this slice is most
  exposed to, and it is undetectable by a harness whose every fixture expects many cards.
- **One with a translation already visible** in the image (`sourceHadTranslation: true`).
- **One without** (`sourceHadTranslation: false`).
- **One that should legitimately yield zero cards** — `expectedCardCount: 0`, `expectedCards: []`.
  A screenshot with no foreign-language content: a UI in the known language, a photo, unreadable
  text. Grades the explanatory empty state (FR-008).
- **At least one genuinely text-heavy source** — a lyrics excerpt, a transcript, a dense exercise
  page — that warrants several distinct cards, one per item.

`npm run eval -- --dry-run` validates every label file and prints the mix without spending a
single API call. Run it first; it warns when a required case is missing.

## Cost

The full matrix is 5 configurations × the number of fixtures, one model call each. Ten fixtures is
50 calls. Cost is dominated by the image (~4k visual tokens for a phone screenshot), not by the
handful of output tokens. Narrow with `--only <config>` / `--fixture <name>` while iterating.
