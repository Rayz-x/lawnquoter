"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ESIGN_DISCLOSURES } from "@/lib/quotes/legal-copy";
import { acceptQuote, declineQuote } from "./actions";

export function AcceptForm({
  token,
  status,
  selectedIds,
  clause,
}: {
  token: string;
  status: string;
  selectedIds: string[];
  clause: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(status === "accepted");

  if (done || status === "accepted") {
    return <p className="rounded-lg border bg-muted/40 p-4 text-sm">This proposal is accepted. Thank you.</p>;
  }
  if (status === "declined") {
    return <p className="rounded-lg border p-4 text-sm">This proposal was declined.</p>;
  }
  if (status === "expired") {
    return <p className="rounded-lg border p-4 text-sm">This proposal has expired. Ask the company for an updated quote.</p>;
  }

  return (
    <form
      className="mt-6 flex flex-col gap-3 rounded-xl border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const r = await acceptQuote(token, fd);
          if (r.ok) {
            toast.success(
              r.data.already
                ? "This proposal was already accepted"
                : r.data.emailed
                  ? "Accepted. We emailed you a sealed copy."
                  : "Accepted",
            );
            setDone(true);
            router.refresh();
          } else toast.error(r.error);
        });
      }}
    >
      {selectedIds.map((id) => (
        <input key={id} type="hidden" name="selected" value={id} />
      ))}
      <h2 className="font-medium">Accept this proposal</h2>
      {clause ? <p className="text-sm">{clause}</p> : null}
      <section className="flex flex-col gap-3 text-sm" aria-labelledby="esign-heading">
        <h3 id="esign-heading" className="font-medium">
          Electronic records
        </h3>
        {ESIGN_DISCLOSURES.map((section) => (
          <p key={section.id}>
            <span className="font-medium">{section.heading}. </span>
            {section.body}
          </p>
        ))}
      </section>
      <p className="text-xs text-muted-foreground">
        By clicking Accept you agree this is your electronic signature. We store your name, email, time, IP, browser, and
        a hash of this document, then email you a sealed PDF copy.
      </p>
      <Field>
        <FieldLabel htmlFor="signer_name">Full legal name</FieldLabel>
        <Input id="signer_name" name="signer_name" autoComplete="name" required />
      </Field>
      <Field>
        <FieldLabel htmlFor="signer_email">Email</FieldLabel>
        <Input id="signer_email" name="signer_email" type="email" autoComplete="email" required />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox name="disclosure" required />
        I consent to do business electronically, I have read the disclosures above, and I accept the work and price shown
        on this proposal.
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Accept
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await declineQuote(token);
              if (r.ok) router.refresh();
              else toast.error(r.error);
            })
          }
        >
          Decline
        </Button>
      </div>
    </form>
  );
}
