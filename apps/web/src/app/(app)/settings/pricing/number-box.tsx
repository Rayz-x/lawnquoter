"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";

/** Plain number box with a "$" prefix or a "%", "min", "in" suffix. Commits a number, never text. */
export function NumberBox({
  label,
  value,
  onChange,
  prefix,
  suffix,
  min = 0,
  max,
  step = "any",
  disabled,
  hideLabel,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number | "any";
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label htmlFor={id} className="inline-flex flex-col gap-1 text-sm">
      <span className={hideLabel ? "sr-only" : "text-muted-foreground"}>{label}</span>
      <span className="inline-flex h-11 items-center rounded-md border bg-background px-2 focus-within:ring-2 focus-within:ring-ring lg:h-9">
        {prefix ? <span aria-hidden className="pe-1 text-muted-foreground">{prefix}</span> : null}
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          className="h-auto w-20 border-0 p-0 text-right tabular-nums shadow-none focus-visible:ring-0"
          value={draft ?? String(value)}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            const next = Number(raw);
            if (raw.trim() !== "" && Number.isFinite(next)) onChange(next);
          }}
          onBlur={() => setDraft(null)}
        />
        {suffix ? <span aria-hidden className="ps-1 text-muted-foreground">{suffix}</span> : null}
      </span>
    </label>
  );
}
