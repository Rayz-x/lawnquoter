"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function MoreDisclosure({ label = "More", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div data-entry="more-disclosure">
      <Button type="button" variant="ghost" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
        {label}
      </Button>
      <div id={panelId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
