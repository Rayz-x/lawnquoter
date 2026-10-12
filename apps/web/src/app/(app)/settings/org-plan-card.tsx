"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { SectionCard } from "@/components/entry";
import { HelpTip } from "@/components/help/help-tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { Spinner } from "@/components/ui/spinner";
import { startOrgPlan } from "./org-plan-actions";

const TIERS = [
  { id: "starter", label: "Starter" },
  { id: "growth", label: "Growth" },
  { id: "scale", label: "Scale" },
] as const;

const STATUS: Record<string, string> = {
  incomplete: "Incomplete",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
};

export function OrgPlanCard({
  canStart,
  notice,
  plan,
}: {
  canStart: boolean;
  notice: string | null;
  plan: { tier: string; status: string } | null;
}) {
  const [pending, startTransition] = useTransition();
  const choose = (tier: string) => {
    startTransition(async () => {
      const result = await startOrgPlan(tier);
      if (!result.ok) return void toast.error(result.error);
      window.location.href = result.data.url;
    });
  };
  const current = TIERS.find((tier) => tier.id === plan?.tier);
  return (
    <SectionCard
      title="LawnQuoter plan"
      heading="h2"
      description="One flat monthly price for this company. Test mode only."
      menu={plan ? <Badge variant="outline">{STATUS[plan.status] ?? plan.status}</Badge> : undefined}
      className="w-full min-w-0"
    >
      <HelpTip
        label="Help for the plan"
        text="Billing stays off until a Stripe test key is set, and checkout stays in test mode."
        href="/help/plan-and-billing#when-billing-stays-off"
      />
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
      {current ? <p className="text-sm">{current.label}</p> : null}
      {!notice && canStart ? (
        <div role="group" aria-label="Plan" className="flex w-full min-w-0 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {TIERS.map((tier) => (
              <Button key={tier.id} type="button" variant={plan?.tier === tier.id ? "default" : "outline"} disabled={pending} onClick={() => choose(tier.id)}>
                {pending ? <Spinner data-icon="inline-start" /> : null}
                {tier.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}
