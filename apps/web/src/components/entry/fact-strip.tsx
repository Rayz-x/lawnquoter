import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export type FactStripItem = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  /** Shown with a ✦, for example "From parcel". */
  hint?: string;
};

export function FactStrip({ facts }: { facts: readonly FactStripItem[] }) {
  return (
    <Card data-entry="fact-strip">
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{fact.label}</dt>
              <dd className="text-sm font-medium">{fact.value}</dd>
              {fact.detail || fact.hint ? (
                <dd className="text-xs text-muted-foreground">
                  {fact.hint ? <span>✦ {fact.hint}</span> : null}
                  {fact.hint && fact.detail ? " " : null}
                  {fact.detail}
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
