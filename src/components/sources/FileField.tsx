import { CircleAlert, ImageUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCEPTED_IMAGE_ACCEPT_ATTRIBUTE, ACCEPTED_IMAGE_LABEL, MAX_UPLOAD_LABEL } from "@/lib/upload-limits";

interface FileFieldProps {
  id: string;
  name?: string;
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Native file input styled to match `FormField`.
 *
 * `accept` is a hint the browser can ignore, so it never stands in for the real size/format
 * checks — those run in `AddSourceForm` and, authoritatively, in `POST /api/sources`.
 */
export function FileField({ id, name, label, file, onChange, error }: FileFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-blue-100/80">
        {label}
      </label>
      <div className="relative">
        <span className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40">
          <ImageUp className="size-4" />
        </span>
        <input
          id={id}
          name={name ?? id}
          type="file"
          accept={ACCEPTED_IMAGE_ACCEPT_ATTRIBUTE}
          onChange={(e) => {
            onChange(e.target.files?.[0] ?? null);
          }}
          className={cn(
            "w-full rounded-lg border bg-white/10 py-2 pr-3 pl-10 text-sm text-white transition-colors file:mr-3 file:rounded-md file:border-0 file:bg-white/15 file:px-3 file:py-1 file:text-sm file:text-white hover:file:bg-white/25 focus:ring-2 focus:outline-none",
            error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
          )}
        />
      </div>
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3" />
          {error}
        </p>
      ) : (
        <p className="mt-1 text-xs text-blue-100/50">
          {file ? `${file.name} · ${formatBytes(file.size)}` : `${ACCEPTED_IMAGE_LABEL}, up to ${MAX_UPLOAD_LABEL}`}
        </p>
      )}
    </div>
  );
}
