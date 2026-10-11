"use client";

import { useState, useTransition } from "react";
import { issuePaymentRefund } from "./actions";

export function RefundButton({ paymentId }: { paymentId: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <span className="flex items-center gap-2">
      {message ? <span className="text-muted-foreground text-xs">{message}</span> : null}
      <button
        type="button"
        className="border px-2 py-1 text-xs disabled:opacity-50"
        disabled={pending}
        onClick={() => {
          start(async () => {
            setMessage(null);
            const result = await issuePaymentRefund(paymentId);
            if (!result.ok) {
              setMessage(result.error);
              return;
            }
            setMessage("Refund requested — waiting for Stripe webhook.");
          });
        }}
      >
        {pending ? "Refunding…" : "Refund"}
      </button>
    </span>
  );
}
