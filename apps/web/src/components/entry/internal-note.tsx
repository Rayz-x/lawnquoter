import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function InternalNote({ children, label = "Internal note" }: { children: ReactNode; label?: string }) {
  return (
    <Card data-entry="internal-note" data-weight="internal" className="w-full bg-muted">
      <CardContent className="flex w-full flex-col gap-2">
        <div className="flex items-center gap-2">
          <Lock aria-hidden="true" className="size-4 shrink-0" />
          <p className="text-xs font-medium">{label}</p>
        </div>
        <div className="w-full min-w-0 [&_textarea]:field-sizing-fixed [&_textarea]:w-full">{children}</div>
      </CardContent>
    </Card>
  );
}
