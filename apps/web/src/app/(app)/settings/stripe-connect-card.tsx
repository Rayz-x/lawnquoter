"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ConnectStatus } from "@/lib/stripe/connect";
import { openStripeDashboard, startStripeConnect } from "./stripe-connect-actions";

const LABELS: Record<ConnectStatus, string> = {
  not_connected: "Not connected",
  pending: "Pending",
  ready: "Ready",
};

function statusBadgeClass(status: ConnectStatus) {
  if (status === "pending") return "border-transparent bg-warning/15 text-warning";
  if (status === "ready") return "border-transparent bg-success/10 text-success";
  return undefined;
}

export function StripeConnectCard({ isOwner, status }: { isOwner: boolean; status: ConnectStatus }) {
  const [pending, startTransition] = useTransition();
  const connect = () => {
    startTransition(async () => {
      const result = await startStripeConnect();
      if (!result.ok) return void toast.error(result.error);
      window.location.href = result.data.url;
    });
  };
  const openDashboard = () => {
    startTransition(async () => {
      const result = await openStripeDashboard();
      if (!result.ok) return void toast.error(result.error);
      window.location.href = result.data.url;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Badge variant="outline" className={statusBadgeClass(status)}>
        {LABELS[status]}
      </Badge>
      {isOwner ? (
        <div className="flex flex-wrap gap-3">
          {status === "ready" ? (
            <Button type="button" variant="outline" onClick={openDashboard} disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Open Stripe dashboard
            </Button>
          ) : (
            <Button type="button" onClick={connect} disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {status === "not_connected" ? "Connect Stripe" : "Continue setup"}
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only the company owner can start Stripe Connect.</p>
      )}
    </div>
  );
}
