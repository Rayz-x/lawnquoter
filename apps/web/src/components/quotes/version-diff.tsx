import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import type { QuoteVersionChange } from "@/lib/quotes/version-diff";

function lineLabel(name: string, price: number) {
  return `${name} · ${formatMoney(price)}`;
}

export function QuoteVersionDiffCard({ fromVersion, changes }: { fromVersion: number; changes: QuoteVersionChange[] }) {
  return (
    <Card data-testid="quote-version-diff">
      <CardHeader>
        <CardTitle>Changes from version {fromVersion}</CardTitle>
      </CardHeader>
      <CardContent>
        {changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No line changes.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {changes.map((change) => {
              if (change.kind === "added") {
                return <li key={`added-${change.line.key}`}>Added {lineLabel(change.line.name, change.line.price)}</li>;
              }
              if (change.kind === "removed") {
                return <li key={`removed-${change.line.key}`}>Removed {lineLabel(change.line.name, change.line.price)}</li>;
              }
              return (
                <li key={`changed-${change.after.key}`}>
                  {change.after.name} · {formatMoney(change.before.price)} → {formatMoney(change.after.price)}
                  {change.before.qty !== change.after.qty ? ` · qty ${change.before.qty} → ${change.after.qty}` : ""}
                  {change.before.state !== change.after.state ? ` · ${change.before.state} → ${change.after.state}` : ""}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
