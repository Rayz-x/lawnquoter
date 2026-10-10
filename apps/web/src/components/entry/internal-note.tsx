import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function InternalNote({ children, label = "Internal note" }: { children: ReactNode; label?: string }) {
  return (
    <Card data-entry="internal-note" data-weight="internal" className="bg-muted">
      <CardContent>
        <div className="flex gap-2">
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">{label}</p>
            <div className="text-sm">{children}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
