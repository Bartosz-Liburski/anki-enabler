import React, { useState } from "react";
import { Trash2, TriangleAlert } from "lucide-react";
import { SubmitButton } from "@/components/auth/SubmitButton";

interface Props {
  sourceId: string;
  /** How many cards go with the source. Zero is normal — a never-generated source is deletable. */
  cardCount: number;
}

/**
 * Delete a source, with a confirmation step (S-04, FR-006).
 *
 * The same arm-then-confirm shape regeneration uses (`RegenerateForm`): the first click only arms
 * the action, and the submitted form carries `confirm=delete`. That field is what the endpoint's own
 * guard reads, so the protection holds even if this island never hydrates or is bypassed entirely.
 * This UI is the courtesy, not the enforcement.
 *
 * Styled red rather than the primary purple on purpose — this button sits below "Regenerate" and
 * "Download CSV", and a destructive action that looks like its neighbours is a misclick waiting to
 * happen.
 */
export default function DeleteSourceForm({ sourceId, cardCount }: Props) {
  const [armed, setArmed] = useState(false);

  function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    if (!armed) {
      event.preventDefault();
      setArmed(true);
    }
  }

  return (
    <form
      method="POST"
      action={`/api/sources/${sourceId}/delete`}
      className="space-y-3 text-left"
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="confirm" value="delete" />

      {armed && (
        <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-900/30 px-3 py-2 text-sm text-red-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            This permanently deletes the screenshot
            {cardCount > 0 && ` and ${cardCount === 1 ? "its flashcard" : `all ${cardCount} of its flashcards`}`}. There
            is no undo. Press again to confirm.
          </span>
        </p>
      )}

      <SubmitButton
        pendingText="Deleting..."
        icon={<Trash2 className="size-4" />}
        className="w-full rounded-lg border border-red-500/40 bg-red-900/40 px-4 py-2 font-medium text-red-200 transition-colors hover:bg-red-900/60"
      >
        {armed ? "Yes, delete permanently" : "Delete this source"}
      </SubmitButton>
    </form>
  );
}
