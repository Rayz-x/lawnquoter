import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { PipelineColumn } from "./pipeline";

/** Kanban of pipeline stages. Cards show the owner, a lost reason, and a rotting flag. */
export function PipelineBoard({ columns }: { columns: readonly PipelineColumn[] }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2" data-testid="pipeline-board">
      {columns.map((column) => (
        <section key={column.stage} aria-label={column.label} className="w-64 shrink-0 rounded-lg border bg-muted/30 p-2">
          <header className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold">{column.label}</h2>
            <span className="text-xs text-muted-foreground">{column.cards.length}</span>
          </header>
          <ul className="flex flex-col gap-2">
            {column.cards.length === 0 ? (
              <li className="px-1 text-xs text-muted-foreground">No leads</li>
            ) : (
              column.cards.map((card) => (
                <li key={card.id} className="rounded-md border bg-background p-2">
                  <Link href={`/leads/${card.id}`} className="font-medium hover:underline">
                    {card.name}
                  </Link>
                  <div className="mt-1 text-xs text-muted-foreground">{card.ownerName}</div>
                  {card.lostReasonLabel ? (
                    <div className="mt-1 text-xs">Lost: {card.lostReasonLabel}</div>
                  ) : null}
                  {card.rotting ? (
                    <Badge variant="outline" className="mt-2 border-destructive/40 text-destructive">
                      Rotting
                    </Badge>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
