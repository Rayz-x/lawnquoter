"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { convertAcceptedQuote } from "@/lib/actions/scheduling";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function ConvertToJobForm({ quoteId, defaultStartDate }: { quoteId: string; defaultStartDate: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"one_time" | "recurring">("one_time");
  const [frequency, setFrequency] = useState<"weekly" | "biweekly" | "monthly">("weekly");
  const [preferredDow, setPreferredDow] = useState("1");
  const [startDate, setStartDate] = useState(defaultStartDate);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Convert to job</CardTitle>
        <CardDescription>One-time work, or a recurring visit on a weekday.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            startTransition(async () => {
              const result = await convertAcceptedQuote(quoteId, {
                kind,
                startDate,
                frequency: kind === "recurring" ? frequency : undefined,
                preferredDow: kind === "recurring" ? Number(preferredDow) : undefined,
              });
              if (result.ok) {
                toast.success("Quote converted to a job");
                router.push(`/agreements/${result.data.agreementId}`);
                router.refresh();
              } else {
                toast.error(result.error);
              }
            });
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="convert-kind">Kind</FieldLabel>
              <NativeSelect
                id="convert-kind"
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
                  <FieldLabel htmlFor="convert-frequency">Frequency</FieldLabel>
                  <NativeSelect
                    id="convert-frequency"
                    required
                    value={frequency}
                    onChange={(event) => setFrequency(event.target.value as typeof frequency)}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every two weeks</option>
                    <option value="monthly">Monthly</option>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="convert-dow">Preferred day</FieldLabel>
                  <NativeSelect id="convert-dow" required value={preferredDow} onChange={(event) => setPreferredDow(event.target.value)}>
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
              <FieldLabel htmlFor="convert-start">Start date</FieldLabel>
              <Input id="convert-start" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </Field>
          </FieldGroup>
          <Button type="submit" disabled={pending || startDate.length === 0}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Convert to job
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
