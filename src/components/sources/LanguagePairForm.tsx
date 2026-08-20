import React, { useState } from "react";
import { ArrowRight, BookOpen, GraduationCap } from "lucide-react";
import { SelectField } from "@/components/sources/SelectField";
import { Button } from "@/components/ui/button";
import { LANGUAGES, isSupportedLanguage } from "@/lib/languages";

interface Props {
  learnedLanguage?: string;
  knownLanguage?: string;
}

interface Errors {
  learnedLanguage?: string;
  knownLanguage?: string;
}

/**
 * Step 1 of adding sources: pick the learning direction (S-01).
 *
 * Submits as a plain `GET` to `/dashboard`, so the field names *are* the query-param names —
 * the browser builds `?learned_language=es&known_language=pl` with no mapping code, the pair
 * is bookmarkable, and the step works with JS disabled. The pair then rides every redirect
 * back from `POST /api/sources`, which is what lets one pair take many sources in a row.
 */
export default function LanguagePairForm({ learnedLanguage = "", knownLanguage = "" }: Props) {
  const [learned, setLearned] = useState(learnedLanguage);
  const [known, setKnown] = useState(knownLanguage);
  const [errors, setErrors] = useState<Errors>({});

  function validate() {
    const next: Errors = {};

    if (!isSupportedLanguage(learned)) {
      next.learnedLanguage = "Pick the language you're learning";
    }

    if (!isSupportedLanguage(known)) {
      next.knownLanguage = "Pick the language you already know";
    } else if (known === learned) {
      next.knownLanguage = "Pick a language different from the one you're learning";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="GET" action="/dashboard" className="space-y-4 text-left" onSubmit={handleSubmit} noValidate>
      <SelectField
        id="learned_language"
        label="Language you're learning"
        value={learned}
        onChange={(value) => {
          setLearned(value);
          setErrors({});
        }}
        options={LANGUAGES}
        placeholder="Select a language"
        error={errors.learnedLanguage}
        icon={<GraduationCap className="size-4" />}
      />

      <SelectField
        id="known_language"
        label="Language you already know"
        value={known}
        onChange={(value) => {
          setKnown(value);
          setErrors({});
        }}
        options={LANGUAGES}
        placeholder="Select a language"
        error={errors.knownLanguage}
        icon={<BookOpen className="size-4" />}
      />

      <Button
        type="submit"
        className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
      >
        <span className="flex items-center gap-2">
          Continue
          <ArrowRight className="size-4" />
        </span>
      </Button>
    </form>
  );
}
