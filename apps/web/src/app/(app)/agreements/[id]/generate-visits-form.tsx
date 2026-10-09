"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { generateVisits } from "@/lib/actions/scheduling";

export function GenerateVisitsForm({
  agreementId,
  defaultThrough,
}: {
  agreementId: string;
  defaultThrough: string;
}) {
  const router = useRouter();
  const [through, setThrough] = useState(defaultThrough);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await generateVisits(agreementId, through);
          if (result.ok) {
            toast.success(result.data.created === 0 ? "No new visits in that range" : `Created ${result.data.created} visits`);
            router.refresh();
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      <Field>
        <FieldLabel htmlFor="through-date">Generate through</FieldLabel>
        <Input
          id="through-date"
          type="date"
          required
          value={through}
          onChange={(event) => setThrough(event.target.value)}
        />
      </Field>
      <Button type="submit" disabled={pending || through.length === 0}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Generate visits
      </Button>
    </form>
  );
}
