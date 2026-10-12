"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { DEPOSIT_NOT_CONNECTED } from "@/lib/billing/deposit";
import { formatMoney } from "@/lib/money";
import { ESIGN_DISCLOSURES } from "@/lib/quotes/legal-copy";
import { acceptQuote, declineQuote } from "./actions";
import { startDepositPayment } from "./deposit-actions";

export function AcceptForm({
  token,
  status,
  selectedIds,
  clause,
  acceptLabel = "Accept",
  depositCents = 0,
  stripeReady = false,
}: {
  token: string;
  status: string;
  selectedIds: string[];
  clause: string | null;
  acceptLabel?: string;
  depositCents?: number;
  stripeReady?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(status === "accepted");

  function payDeposit() {
    startTransition(async () => {
      const pay = await startDepositPayment(token);
      if (pay.ok && pay.data.url) {
        window.location.href = pay.data.url;
        return;
      }
      if (pay.ok) toast.success("This deposit is already paid.");
      else toast.error(pay.error);
    });
  }

  if (done || status === "accepted") {
    return (
      <div className="rounded-lg border bg-muted/40 p-4 text-sm">
        <p>This proposal is accepted. Thank you.</p>
        {depositCents > 0 && stripeReady ? (
          <Button type="button" className="mt-3" disabled={pending} onClick={payDeposit}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Pay the deposit
          </Button>
        ) : null}
        {depositCents > 0 && !stripeReady ? <p className="mt-2">{DEPOSIT_NOT_CONNECTED}</p> : null}
      </div>
    );
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
            if (depositCents > 0 && stripeReady) {
              const pay = await startDepositPayment(token);
              if (pay.ok && pay.data.url) {
                window.location.href = pay.data.url;
                return;
              }
              if (!pay.ok) {
                toast.error(pay.error);
                return;
              }
            }
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
      {depositCents > 0 ? (
        <p className="text-sm">
          A deposit of {formatMoney(depositCents / 100, { cents: true })} is collected when you accept.
          {stripeReady ? null : ` ${DEPOSIT_NOT_CONNECTED}`}
        </p>
      ) : null}
      {clause ? (
        <p className="text-sm" data-testid="accept-nte-clause">
          {clause}
        </p>
      ) : null}
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
          {acceptLabel}
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
