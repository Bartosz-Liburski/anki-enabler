import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

const PRIMARY_CLASSES =
  "w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500";

interface SubmitButtonProps {
  pendingText: string;
  icon: ReactNode;
  children: ReactNode;
  /**
   * Override the button's styling. Exists for destructive actions (S-04's delete), which must not
   * look like the primary purple call to action they sit next to — a delete button that reads as
   * "Generate flashcards" is a misclick waiting to happen. Defaults to the primary style, so every
   * existing caller is unaffected.
   */
  className?: string;
}

export function SubmitButton({ pendingText, icon, children, className = PRIMARY_CLASSES }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className={className}>
      {pending ? (
        <span className="flex items-center gap-2">
          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          {pendingText}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {icon}
          {children}
        </span>
      )}
    </Button>
  );
}
