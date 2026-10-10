"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type ChipOption = {
  value: string;
  label: string;
};

/** Single-select pills. 44 px below `lg`, 32 px on desktop. Pass Unknown when the field can be unset. */
export function ChipGroup({
  label,
  options,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  options: readonly ChipOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      data-entry="chip-group"
      disabled={disabled}
      multiple={false}
      value={value ? [value] : []}
      onValueChange={(next) => {
        const picked = next[0];
        if (picked) onValueChange?.(picked);
      }}
      className="flex flex-wrap"
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="h-11 rounded-full px-3 lg:h-8">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
