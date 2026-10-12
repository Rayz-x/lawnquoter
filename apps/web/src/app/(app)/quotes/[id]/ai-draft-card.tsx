"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import type { MemoryLine } from "@/lib/quotes/neighborhood-draft";
import { addDraftLines, suggestQuoteDraft } from "../draft-action";

export function AiDraftCard({ quoteId, connected }: { quoteId: string; connected: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<MemoryLine[] | null>(null);
  const [source, setSource] = useState<"ai" | "similar" | "none" | null>(null);

  const note = !connected
    ? "Not connected — add AI_QUOTE_API_KEY and AI_QUOTE_API_URL to enable an AI draft. Similar quotes nearby still fill a draft."
    : source === "ai"
      ? "Drafted with the connected AI provider."
      : source === "similar" || source === "none"
        ? "The AI provider did not return a draft. These prices are from similar quotes nearby."
        : "An AI provider is connected. Similar quotes are the fallback.";

  return (
    <Card data-testid="ai-draft-card">
      <CardHeader>
        <CardTitle>Draft from nearby quotes</CardTitle>
        <CardDescription>{note}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 w-fit"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const draft = await suggestQuoteDraft(quoteId);
              if (!draft.ok) {
                toast.error(draft.error);
                return;
              }
              setSource(draft.data.source);
              setLines(draft.data.lines);
            })
          }
        >
          Suggest lines
        </Button>
        {lines && lines.length === 0 ? <p className="text-sm text-muted-foreground">No similar accepted quotes yet.</p> : null}
        {lines && lines.length > 0 ? (
          <>
            <ul className="flex flex-col gap-1 text-sm">
              {lines.map((line) => (
                <li key={`${line.name}-${line.price}`}>
                  {line.name} · {formatMoney(line.price)}
                </li>
              ))}
            </ul>
            <Button
              type="button"
              className="min-h-11 w-fit"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const added = await addDraftLines(quoteId, lines);
                  if (!added.ok) {
                    toast.error(added.error);
                    return;
                  }
                  toast.success(`Added ${added.data.count} lines`);
                  setLines(null);
                  router.refresh();
                })
              }
            >
              Add these lines
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
