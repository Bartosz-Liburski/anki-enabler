import { useState } from "react";
import { Save } from "lucide-react";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

export interface ReviewCard {
  id: string;
  front: string;
  back: string;
  discarded: boolean;
}

interface Props {
  sourceId: string;
  cards: ReviewCard[];
  learnedLanguageLabel: string;
  knownLanguageLabel: string;
  serverError?: string | null;
}

/**
 * The single review screen from FR-009: the whole set at once, discard per card, one save.
 *
 * A real `<form method="POST">` with one checkbox per card, so the browser's native submission
 * carries the full decision set and the flow survives a failed hydration — the same
 * progressive-enhancement pattern S-01's upload form established. React state exists only to keep
 * the kept-count readable while you toggle; nothing about correctness depends on it.
 *
 * Deliberately no per-card request: FR-009 asks for one screen and one save, and a save-per-toggle
 * would turn an abandoned review into a half-applied one.
 */
export default function ReviewCardList({
  sourceId,
  cards,
  learnedLanguageLabel,
  knownLanguageLabel,
  serverError,
}: Props) {
  const [discarded, setDiscarded] = useState<Set<string>>(
    () => new Set(cards.filter((card) => card.discarded).map((card) => card.id)),
  );

  const keptCount = cards.length - discarded.size;

  function toggle(id: string, isDiscarded: boolean) {
    setDiscarded((previous) => {
      const next = new Set(previous);
      if (isDiscarded) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  return (
    <form method="POST" action={`/api/sources/${sourceId}/review`} className="space-y-4 text-left">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Review flashcards</h2>
        <p className="text-sm text-blue-100/60" aria-live="polite">
          Keeping <span className="font-semibold text-white">{keptCount}</span> of {cards.length}
        </p>
      </div>

      <ul className="space-y-2">
        {cards.map((card) => {
          const isDiscarded = discarded.has(card.id);
          return (
            <li
              key={card.id}
              className={`rounded-lg border px-3 py-2 transition-colors ${
                isDiscarded ? "border-white/10 bg-white/5 opacity-50" : "border-white/20 bg-white/10"
              }`}
            >
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  name="discard"
                  value={card.id}
                  checked={isDiscarded}
                  onChange={(event) => {
                    toggle(card.id, event.currentTarget.checked);
                  }}
                  className="mt-1 size-4 shrink-0 accent-purple-500"
                />
                <span className="min-w-0 flex-1">
                  <span className={`block font-medium break-words ${isDiscarded ? "line-through" : ""}`}>
                    {card.front}
                  </span>
                  <span className="mt-0.5 block text-sm break-words text-blue-100/70">{card.back}</span>
                  <span className="mt-1 block text-xs text-blue-100/40">
                    {learnedLanguageLabel} → {knownLanguageLabel}
                  </span>
                </span>
                <span className="shrink-0 self-center text-xs tracking-wide text-blue-100/50 uppercase">
                  {isDiscarded ? "Discarded" : "Keep"}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <ServerError message={serverError} />

      <SubmitButton pendingText="Saving..." icon={<Save className="size-4" />}>
        Save review
      </SubmitButton>
      <p className="text-xs text-blue-100/50">
        Ticking a card discards it. Kept cards are the ones you&apos;ll export.
      </p>
    </form>
  );
}
