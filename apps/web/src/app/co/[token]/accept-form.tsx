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
import { acceptChangeOrder } from "./actions";

export function ChangeOrderAcceptForm({
  token,
  status,
}: {
  token: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(status === "accepted");

  if (done || status === "accepted") {
    return (
      <p className="rounded-lg border bg-muted/40 p-4 text-sm" data-testid="change-order-accepted">
        This change order is accepted. Thank you.
      </p>
    );
  }
  if (status === "declined") {
    return <p className="rounded-lg border p-4 text-sm">This change order was declined.</p>;
  }

  return (
    <form
      className="mt-6 flex flex-col gap-3 rounded-xl border p-4"
      data-testid="change-order-accept-form"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const r = await acceptChangeOrder(token, fd);
          if (r.ok) {
            toast.success(r.data.already ? "This change order was already accepted" : "Change order accepted");
            setDone(true);
            router.refresh();
          } else toast.error(r.error);
        });
      }}
    >
      <h2 className="font-medium">Accept this change order</h2>
      <section className="flex flex-col gap-3 text-sm" aria-labelledby="co-esign-heading">
        <h3 id="co-esign-heading" className="font-medium">
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
        By clicking Accept you agree this is your electronic signature. We store your name, email, time, and a hash of
        this change order.
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
        I consent to do business electronically, I have read the disclosures above, and I accept this change order.
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending} data-testid="change-order-accept">
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Accept change order
        </Button>
      </div>
    </form>
  );
}
