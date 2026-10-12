"use client";

import type { ReactNode } from "react";
import { Switch } from "@/components/ui/switch";

export function ToggleRow({
  label,
  checked,
  onCheckedChange,
  description,
  disabled,
  describedBy,
}: {
  label: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: ReactNode;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <label data-entry="toggle-row" className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3">
      <span className="text-sm">
        {label}
        {description ? <span className="mt-0.5 block text-muted-foreground">{description}</span> : null}
      </span>
      <Switch checked={checked} disabled={disabled} aria-describedby={describedBy} onCheckedChange={onCheckedChange} />
    </label>
  );
}
