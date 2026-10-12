"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpTip } from "@/components/help/help-tip";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { applyLateFees, saveLateFees } from "./late-fee-actions";

export function LateFeeCard({
  flatCents,
  feeBps,
  graceDays,
  canEdit,
}: {
  flatCents: number;
  feeBps: number;
  graceDays: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [flat, setFlat] = useState((flatCents / 100).toFixed(2));
  const [percent, setPercent] = useState((feeBps / 100).toString());
  const [grace, setGrace] = useState(String(graceDays));

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          Late fees
          <HelpTip
            label="Help for late fees"
            text="A separate draft after the grace days. The original invoice total stays as issued."
            href="/help/late-fees#set-the-fee"
          />
        </CardTitle>
        <CardDescription>A separate draft after the grace days. The original invoice total stays as issued.</CardDescription>
      </CardHeader>
      <CardContent>
        {canEdit ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const dollars = Number(flat);
              const pct = Number(percent);
              startTransition(async () => {
                const result = await saveLateFees({
                  flatCents: Number.isFinite(dollars) ? Math.round(dollars * 100) : -1,
                  feeBps: Number.isFinite(pct) ? Math.round(pct * 100) : -1,
                  graceDays: Number(grace),
                });
                if (result.ok) {
                  toast.success("Late fees saved");
                  router.refresh();
                } else {
                  toast.error(result.error);
                }
              });
            }}
          >
            <p className="text-sm text-muted-foreground">Leave both amounts at zero to keep late fees off.</p>
            <Field>
              <FieldLabel htmlFor="late-flat">Flat amount</FieldLabel>
              <Input id="late-flat" type="number" min="0" step="0.01" value={flat} onChange={(event) => setFlat(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="late-percent">Percent of the open balance</FieldLabel>
              <Input id="late-percent" type="number" min="0" max="100" step="0.01" value={percent} onChange={(event) => setPercent(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="late-grace">Grace days</FieldLabel>
              <Input id="late-grace" type="number" min="0" max="365" value={grace} onChange={(event) => setGrace(event.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                Save late fees
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    const result = await applyLateFees();
                    if (result.ok) {
                      toast.success(
                        result.data.count === 0
                          ? "No late fees this month"
                          : `Drafted ${result.data.count} late ${result.data.count === 1 ? "fee" : "fees"}`,
                      );
                      router.refresh();
                    } else {
                      toast.error(result.error);
                    }
                  });
                }}
              >
                Add this month&apos;s late fees
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">
            {flatCents === 0 && feeBps === 0
              ? "Late fees are off."
              : `Late fees are $${(flatCents / 100).toFixed(2)} plus ${feeBps / 100}% after ${graceDays} grace days.`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
