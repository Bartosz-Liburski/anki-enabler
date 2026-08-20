import type { ReactNode } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  id: string;
  name?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder: string;
  error?: string;
  icon: ReactNode;
}

/**
 * Native `<select>` styled to match `FormField`'s inputs.
 *
 * Native on purpose: the form falls back to a plain browser POST when the island has not
 * hydrated, so the control has to carry its value without JS.
 */
export function SelectField({ id, name, label, value, onChange, options, placeholder, error, icon }: SelectFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-blue-100/80">
        {label}
      </label>
      <div className="relative">
        <span className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-white/40">{icon}</span>
        <select
          id={id}
          name={name ?? id}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          className={cn(
            "w-full appearance-none rounded-lg border bg-white/10 px-3 py-2 pr-10 pl-10 text-white transition-colors focus:ring-2 focus:outline-none",
            value ? "text-white" : "text-white/40",
            error ? "border-red-400/60 focus:ring-red-400" : "border-white/20 focus:ring-purple-400",
          )}
        >
          <option value="" disabled className="bg-slate-900 text-white/60">
            {placeholder}
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value} className="bg-slate-900 text-white">
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-white/40" />
      </div>
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
          <CircleAlert className="size-3" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
