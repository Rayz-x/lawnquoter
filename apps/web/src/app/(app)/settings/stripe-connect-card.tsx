"use client";

import { useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/entry";
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

function FactRows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="flex flex-col gap-1">
      {rows.map((row) => (
        <div key={row.label} className="grid gap-0.5 lg:grid-cols-[7.5rem_minmax(0,1fr)] lg:items-center lg:gap-x-3">
          <dt className="text-sm text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 text-sm">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StripeConnectCard({
  isOwner,
  status,
  accountLast4,
  payoutsEnabled,
}: {
  isOwner: boolean;
  status: ConnectStatus;
  accountLast4?: string | null;
  payoutsEnabled?: boolean;
}) {
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

  const badge = (
    <Badge variant="outline" className={statusBadgeClass(status)}>
      {LABELS[status]}
    </Badge>
  );

  return (
    <SectionCard
      title="Payments"
      heading="h2"
      description="Take deposits and card payments. Money goes straight to your Stripe account."
      menu={badge}
      className="w-full min-w-0"
    >
      <div className="flex w-full min-w-0 flex-col gap-4">
        {status === "pending" ? (
          <p className="text-sm text-muted-foreground">
            Stripe needs a few more details before you can take payments.
          </p>
        ) : null}
        {status === "ready" ? (
          <FactRows
            rows={[
              { label: "Payouts", value: payoutsEnabled ? "On" : "Off" },
              { label: "Account", value: accountLast4 ? `•••• ${accountLast4}` : "—" },
            ]}
          />
        ) : null}
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
    </SectionCard>
  );
}
