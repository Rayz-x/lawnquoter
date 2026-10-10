"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Stepper({
  label,
  value,
  onValueChange,
  min = 0,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  function set(next: number) {
    if (!Number.isFinite(next)) return;
    const low = Math.max(min, next);
    setDraft(null);
    onValueChange(max === undefined ? low : Math.min(max, low));
  }

  return (
    <div role="group" aria-label={label} data-entry="stepper" className="inline-flex items-center gap-1">
      <Button type="button" variant="outline" className="size-11 lg:size-8" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => set(value - step)}>
        −
      </Button>
      <Input
        inputMode="numeric"
        aria-label={label}
        className="h-11 w-16 px-1 text-center lg:h-8"
        value={draft ?? String(value)}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw.trim() === "") { setDraft(""); return; }
          if (!/^\d+$/.test(raw)) return;
          set(Number(raw));
        }}
        onBlur={() => { if (draft === "") set(min); else setDraft(null); }}
      />
      <Button type="button" variant="outline" className="size-11 lg:size-8" aria-label={`Increase ${label}`} disabled={max !== undefined && value >= max} onClick={() => set(value + step)}>
        +
      </Button>
    </div>
  );
}
