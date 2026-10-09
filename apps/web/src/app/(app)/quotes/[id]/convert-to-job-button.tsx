"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { convertAcceptedQuote } from "@/lib/actions/scheduling";

export function ConvertToJobButton({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await convertAcceptedQuote(quoteId);
          if (result.ok) {
            toast.success("Quote converted to a job");
            router.push(`/agreements/${result.data.agreementId}`);
            router.refresh();
          } else {
            toast.error(result.error);
          }
        })
      }
    >
      {pending ? <Spinner data-icon="inline-start" /> : null}
      Convert to job
    </Button>
  );
}
