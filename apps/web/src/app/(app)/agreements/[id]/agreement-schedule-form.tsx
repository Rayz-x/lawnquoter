"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { updateAgreementSchedule } from "@/lib/actions/scheduling";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FREQUENCIES = ["weekly", "biweekly", "monthly"] as const;

type Frequency = (typeof FREQUENCIES)[number];

export function AgreementScheduleForm({
  agreementId,
  kind: initialKind,
  frequency: initialFrequency,
  preferredDow: initialDow,
  startDate: initialStart,
}: {
  agreementId: string;
  kind: "one_time" | "recurring";
  frequency: string | null;
  preferredDow: number | null;
  startDate: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"one_time" | "recurring">(initialKind);
  const [frequency, setFrequency] = useState<Frequency | "">(
    FREQUENCIES.find((item) => item === initialFrequency) ?? "",
  );
  const [preferredDow, setPreferredDow] = useState(initialDow != null && initialDow >= 0 && initialDow <= 6 ? String(initialDow) : "");
  const [startDate, setStartDate] = useState(initialStart);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (kind === "recurring" && (frequency === "" || preferredDow === "")) {
          toast.error("Recurring agreements need a frequency and a preferred day");
          return;
        }
        startTransition(async () => {
          const result = await updateAgreementSchedule({
            agreementId,
            kind,
            startDate,
            frequency: kind === "recurring" && frequency !== "" ? frequency : undefined,
            preferredDow: kind === "recurring" && preferredDow !== "" ? Number(preferredDow) : undefined,
          });
          if (result.ok) {
            toast.success("Schedule saved");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="agreement-kind">Kind</FieldLabel>
          <NativeSelect
            id="agreement-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value === "recurring" ? "recurring" : "one_time")}
          >
            <option value="one_time">One-time</option>
            <option value="recurring">Recurring</option>
          </NativeSelect>
        </Field>
        {kind === "recurring" ? (
          <>
            <Field>
              <FieldLabel htmlFor="agreement-frequency">Frequency</FieldLabel>
              <NativeSelect
                id="agreement-frequency"
                required
                value={frequency}
                onChange={(event) => setFrequency(event.target.value as Frequency | "")}
              >
                <option value="">Choose a frequency</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every two weeks</option>
                <option value="monthly">Monthly</option>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="agreement-dow">Preferred day</FieldLabel>
              <NativeSelect
                id="agreement-dow"
                required
                value={preferredDow}
                onChange={(event) => setPreferredDow(event.target.value)}
              >
                <option value="">Choose a day</option>
                {WEEKDAYS.map((day, index) => (
                  <option key={day} value={String(index)}>
                    {day}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </>
        ) : null}
        <Field>
          <FieldLabel htmlFor="agreement-start">Apply from</FieldLabel>
          <Input
            id="agreement-start"
            type="date"
            required
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </Field>
      </FieldGroup>
      <p className="text-sm text-muted-foreground">
        Preferred-day changes apply from this date. The change week keeps exactly one visit.
      </p>
      <Button type="submit" disabled={pending || startDate.length === 0}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Save schedule
      </Button>
    </form>
  );
}
