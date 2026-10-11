"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { holdAgreementVisits } from "@/lib/actions/scheduling";

export function AgreementHoldForm({ agreementId }: { agreementId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!startDate || !endDate) {
          toast.error("Hold needs a start and end date");
          return;
        }
        if (endDate < startDate) {
          toast.error("Hold end must be on or after the start");
          return;
        }
        startTransition(async () => {
          const result = await holdAgreementVisits({
            agreementId,
            startDate,
            endDate,
            note: note.trim() || undefined,
          });
          if (result.ok) {
            toast.success("Vacation hold saved");
            setStartDate("");
            setEndDate("");
            setNote("");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="hold-start">Hold from</FieldLabel>
          <Input
            id="hold-start"
            type="date"
            required
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="hold-end">Hold through</FieldLabel>
          <Input
            id="hold-end"
            type="date"
            required
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="hold-note">Note</FieldLabel>
          <Input
            id="hold-note"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Customer vacation"
          />
        </Field>
      </FieldGroup>
      <p className="text-sm text-muted-foreground">
        Cancels visits in the range. They are not made up, and a weekday change will not bring them back.
      </p>
      <Button type="submit" variant="outline" disabled={pending || !startDate || !endDate}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Add vacation hold
      </Button>
    </form>
  );
}
