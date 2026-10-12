import type { ReactNode } from "react";
import { cn } from "cn";

/** Short helper under a field, toggle, or button. Wraps on a phone instead of clipping. */
export function FieldHint({ children }: { children: ReactNode }) {
  return (
    <span data-field-hint className="block max-w-full text-start text-xs leading-snug font-normal text-muted-foreground text-pretty wrap-break-word">
      {children}
    </span>
  );
}

export function Hinted({ hint, children, className }: { hint: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn("flex min-w-0 max-w-full flex-col items-start gap-1", className)}>
      {children}
      <FieldHint>{hint}</FieldHint>
    </span>
  );
}
