import React, { useState } from "react";
import { Sparkles, TriangleAlert } from "lucide-react";
import { SubmitButton } from "@/components/auth/SubmitButton";

interface Props {
  sourceId: string;
  /** How many cards this source already has. Zero means this is a first generation. */
  cardCount: number;
}

/**
 * Trigger generation, or re-generation with a confirmation step (S-02, FR-007).
 *
 * Re-generation replaces the set, so it destroys review work. When cards already exist the first
 * click only arms the action — the native POST is blocked until the user confirms — and the
 * submitted form then carries `confirm=replace`.
 *
 * That field is what the endpoint's own guard reads: the protection holds even if this island never
 * hydrates or is bypassed entirely, because the server refuses to replace an existing set without
 * it. This UI is the courtesy, not the enforcement.
 */
export default function RegenerateForm({ sourceId, cardCount }: Props) {
  const hasCards = cardCount > 0;
  const [armed, setArmed] = useState(false);

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    if (hasCards && !armed) {
      event.preventDefault();
      setArmed(true);
    }
  }

  return (
    <form
      method="POST"
      action={`/api/sources/${sourceId}/generate`}
      className="space-y-3 text-left"
      onSubmit={handleSubmit}
    >
      {hasCards && <input type="hidden" name="confirm" value="replace" />}

      {hasCards && armed && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Regenerating replaces all {cardCount} {cardCount === 1 ? "card" : "cards"} and discards the review you
            already did. Press again to confirm.
          </span>
        </p>
      )}

      <SubmitButton pendingText={hasCards ? "Regenerating..." : "Generating..."} icon={<Sparkles className="size-4" />}>
        {!hasCards ? "Generate flashcards" : armed ? "Yes, replace them" : "Regenerate"}
      </SubmitButton>
    </form>
  );
}
