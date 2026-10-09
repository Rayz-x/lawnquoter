"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { revokeInvite } from "../actions";

export function RevokeInviteButton({ inviteId }: { inviteId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await revokeInvite(inviteId);
          if (result.ok) toast.success("Invite revoked");
          else toast.error(result.error);
        });
      }}
    >
      {pending ? <Spinner data-icon="inline-start" /> : null}
      Revoke
    </Button>
  );
}
