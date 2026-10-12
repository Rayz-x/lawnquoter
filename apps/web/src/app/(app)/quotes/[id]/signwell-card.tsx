"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SIGNWELL_NOT_CONNECTED } from "@/lib/billing/signwell";
import { sendSignWellContract } from "./signwell-actions";

export function SignWellCard({
  quoteId,
  connected,
  sent,
  canEdit,
}: {
  quoteId: string;
  connected: boolean;
  sent: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!connected) {
    return <p className="text-sm text-muted-foreground">{SIGNWELL_NOT_CONNECTED}</p>;
  }
  if (sent) {
    return <p className="text-sm text-muted-foreground">A signature request is out for this contract.</p>;
  }
  if (!canEdit) {
    return <p className="text-sm text-muted-foreground">A commercial contract can be sent for signature.</p>;
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await sendSignWellContract(quoteId);
          if (result.ok) {
            toast.success("Signature request sent");
            router.refresh();
          } else {
            toast.error(result.error);
          }
        });
      }}
    >
      <p className="mb-3 text-sm text-muted-foreground">Send this commercial contract through SignWell. Requests stay in test mode.</p>
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner /> : null}
        Send for signature
      </Button>
    </form>
  );
}
