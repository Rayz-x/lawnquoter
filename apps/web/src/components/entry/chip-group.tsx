"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type ChipOption = {
  value: string;
  label: string;
};

/** Single-select pills. 44 px below `lg`, 32 px on desktop. An empty value means unknown. */
export function ChipGroup({
  label,
  options,
  value,
  onValueChange,
  disabled,
  describedBy,
}: {
  label: string;
  options: readonly ChipOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      aria-describedby={describedBy}
      data-entry="chip-group"
      disabled={disabled}
      multiple={false}
      value={value ? [value] : []}
      onValueChange={(next) => onValueChange?.(next[0] ?? "")}
      className="flex flex-wrap"
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="h-11 rounded-full border border-transparent px-3 lg:h-8 aria-pressed:border-primary/30! aria-pressed:bg-primary/10! aria-pressed:text-primary! data-pressed:border-primary/30! data-pressed:bg-primary/10! data-pressed:text-primary! data-[state=on]:border-primary/30! data-[state=on]:bg-primary/10! data-[state=on]:text-primary!">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
