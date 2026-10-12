"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { issueInvoiceAndNotify } from "@/lib/actions/issue-invoice";

export function IssueInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await issueInvoiceAndNotify(invoiceId);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(result.data.emailed ? "Invoice issued and emailed." : "Invoice issued.");
          router.refresh();
        });
      }}
    >
      {pending ? "Issuing…" : "Issue invoice"}
    </Button>
  );
}
