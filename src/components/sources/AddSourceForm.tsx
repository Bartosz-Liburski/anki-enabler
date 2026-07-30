import React, { useState } from "react";
import { Plus } from "lucide-react";
import { FileField } from "@/components/sources/FileField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { ACCEPTED_IMAGE_LABEL, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, isAcceptedImageType } from "@/lib/upload-limits";

interface Props {
  learnedLanguage: string;
  knownLanguage: string;
  serverError?: string | null;
}

/**
 * Step 2 of adding sources: upload a screenshot into an already-chosen pair (S-01).
 *
 * The pair arrives from the page's query params and rides along as hidden fields, so the form
 * itself holds no language state — after each add the endpoint redirects back with the same
 * pair and this form is ready for the next screenshot.
 *
 * A real `<form method="POST">` — the browser does the submitting, so the flow survives a
 * failed hydration. The size/format check here is a fast fail; `POST /api/sources` re-runs it
 * against the same shared constants and is the authoritative gate.
 */
export default function AddSourceForm({ learnedLanguage, knownLanguage, serverError }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  function validate() {
    if (!file) {
      setError("Pick a screenshot to upload");
      return false;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That image is larger than ${MAX_UPLOAD_LABEL}`);
      return false;
    }
    if (!isAcceptedImageType(file.type)) {
      setError(`Only ${ACCEPTED_IMAGE_LABEL} images are supported`);
      return false;
    }
    setError(undefined);
    return true;
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form
      method="POST"
      action="/api/sources"
      encType="multipart/form-data"
      className="space-y-4 text-left"
      onSubmit={handleSubmit}
      noValidate
    >
      <input type="hidden" name="learned_language" value={learnedLanguage} />
      <input type="hidden" name="known_language" value={knownLanguage} />

      <FileField
        id="file"
        label="Screenshot"
        file={file}
        onChange={(next) => {
          setFile(next);
          setError(undefined);
        }}
        error={error}
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Adding source..." icon={<Plus className="size-4" />}>
        Add source
      </SubmitButton>
    </form>
  );
}
