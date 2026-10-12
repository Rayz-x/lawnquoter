import { PAID_ROUTING_HINT } from "@/lib/scheduling/route-optimize";

export function PaidRoutingNotice({ connected }: { connected: boolean }) {
  if (connected) return null;
  return <p className="text-sm text-muted-foreground">{PAID_ROUTING_HINT}</p>;
}
