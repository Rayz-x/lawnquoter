"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { resolveBillingHold } from "@/lib/actions/billing";
import {
  formatCents,
  holdReasonLabel,
  visitIdentityLine,
  type BillingResolution,
  type BillingReviewQueue,
  type BillingReviewVisit,
} from "@/lib/billing/review-queue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

type UpsellDraft = { include: boolean; amountDollars: string; note: string };

export function ReviewQueuePanel({
  queue,
  canWrite,
}: {
  queue: BillingReviewQueue;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [visit, setVisit] = useState<BillingReviewVisit | null>(null);
  const [resolution, setResolution] = useState<BillingResolution>("full");
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [upsells, setUpsells] = useState<Record<string, UpsellDraft>>({});

  const open = (item: BillingReviewVisit) => {
    setVisit(item);
    setResolution("full");
    setTaskIds(item.tasks.map((task) => task.id));
    setUpsells(
      Object.fromEntries(
        item.upsells.map((upsell) => [
          upsell.id,
          { include: false, amountDollars: "0", note: "" },
        ]),
      ),
    );
  };

  const selectedTotal = useMemo(() => {
    if (!visit) return 0;
    let total = 0;
    if (resolution === "full") {
      total += visit.tasks.reduce((sum, task) => sum + task.amount_cents, 0);
    } else if (resolution === "partial") {
      total += visit.tasks
        .filter((task) => taskIds.includes(task.id))
        .reduce((sum, task) => sum + task.amount_cents, 0);
    }
    for (const [id, draft] of Object.entries(upsells)) {
      if (!draft.include) continue;
      const cents = Math.round(Number(draft.amountDollars || "0") * 100);
      if (Number.isFinite(cents) && cents >= 0) total += cents;
      void id;
    }
    return total;
  }, [visit, resolution, taskIds, upsells]);

  const submit = () => {
    if (!visit) return;
    const overrides = Object.entries(upsells)
      .filter(([, draft]) => draft.include)
      .map(([enhancementRequestId, draft]) => ({
        enhancementRequestId,
        amountCents: Math.round(Number(draft.amountDollars || "0") * 100),
        note: draft.note.trim(),
      }));
    for (const item of overrides) {
      if (!item.note) {
        toast.error("Upsell overrides need a note");
        return;
      }
      if (!Number.isFinite(item.amountCents) || item.amountCents < 0) {
        toast.error("Upsell amount must be zero or more");
        return;
      }
    }
    startTransition(async () => {
      const result = await resolveBillingHold({
        visitId: visit.id,
        resolution,
        visitTaskIds: resolution === "partial" ? taskIds : [],
        upsellOverrides: overrides,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        resolution === "zero"
          ? "Marked billed with no charge"
          : `Draft invoice ${formatCents(result.data.totalCents)}`,
      );
      setVisit(null);
      router.refresh();
    });
  };

  return (
    <>
      <Card data-testid="billing-review-queue">
        <CardHeader>
          <CardTitle>Billing review</CardTitle>
          <CardDescription>
            Held visits stay out of Create invoices until you pick full, partial, or $0.
          </CardDescription>
          <Badge variant="outline" data-testid="billing-review-count">
            Held {queue.count}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {queue.items.length === 0 ? (
            <Empty className="border-0 p-4" data-testid="billing-review-empty">
              <EmptyHeader>
                <EmptyTitle>No held visits · Batch can run clean</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            queue.items.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 py-3 last:border-0"
                data-testid={`billing-review-row-${item.id}`}
              >
                <div className="min-w-0">
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{visitIdentityLine(item)}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge variant="secondary">{holdReasonLabel(item.hold_reason)}</Badge>
                    {item.service_date ? (
                      <Badge variant="outline">{item.service_date}</Badge>
                    ) : null}
                  </div>
                </div>
                {canWrite ? (
                  <Button type="button" onClick={() => open(item)}>
                    Resolve
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={visit != null} onOpenChange={(next) => !next && setVisit(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Resolve billing hold</DialogTitle>
            <DialogDescription>
              {visit ? `${visit.title} · ${holdReasonLabel(visit.hold_reason)}` : null}
            </DialogDescription>
          </DialogHeader>
          {visit ? (
            <div className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label htmlFor="resolution">Bill as</Label>
                <NativeSelect
                  id="resolution"
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value as BillingResolution)}
                >
                  <option value="full">Full visit</option>
                  <option value="partial">Partial (chosen lines)</option>
                  <option value="zero">$0 / no charge</option>
                </NativeSelect>
              </div>

              {resolution === "partial" ? (
                <div className="space-y-2">
                  <Label>Lines to bill</Label>
                  <ul className="space-y-2">
                    {visit.tasks.map((task) => {
                      const checked = taskIds.includes(task.id);
                      return (
                        <li key={task.id} className="flex items-center gap-3">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => {
                              setTaskIds((current) =>
                                value === true
                                  ? [...current, task.id]
                                  : current.filter((id) => id !== task.id),
                              );
                            }}
                            id={`task-${task.id}`}
                          />
                          <Label htmlFor={`task-${task.id}`} className="flex-1 font-normal">
                            {task.label}
                            <span className="ml-2 text-muted-foreground">
                              {formatCents(task.amount_cents)}
                            </span>
                          </Label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {visit.upsells.length > 0 ? (
                <div className="space-y-3">
                  <Label>Unaccepted upsells</Label>
                  {visit.upsells.map((upsell) => {
                    const draft = upsells[upsell.id] ?? {
                      include: false,
                      amountDollars: "0",
                      note: "",
                    };
                    return (
                      <div key={upsell.id} className="space-y-2 rounded-md border p-3">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={draft.include}
                            onCheckedChange={(value) =>
                              setUpsells((current) => ({
                                ...current,
                                [upsell.id]: { ...draft, include: value === true },
                              }))
                            }
                            id={`upsell-${upsell.id}`}
                          />
                          <Label htmlFor={`upsell-${upsell.id}`} className="font-normal">
                            Override {upsell.tag.replaceAll("_", " ")}
                          </Label>
                        </div>
                        {draft.include ? (
                          <>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={draft.amountDollars}
                              onChange={(event) =>
                                setUpsells((current) => ({
                                  ...current,
                                  [upsell.id]: { ...draft, amountDollars: event.target.value },
                                }))
                              }
                              aria-label={`Amount for ${upsell.tag}`}
                            />
                            <Textarea
                              value={draft.note}
                              onChange={(event) =>
                                setUpsells((current) => ({
                                  ...current,
                                  [upsell.id]: { ...draft, note: event.target.value },
                                }))
                              }
                              placeholder="Required note (who approved / why)"
                              aria-label={`Note for ${upsell.tag}`}
                            />
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <p className="text-sm text-muted-foreground">
                Draft total {formatCents(selectedTotal)}
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setVisit(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={submit} disabled={pending || !canWrite}>
              Save draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
