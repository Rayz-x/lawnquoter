import type { OrgRole } from "@lawnquoter/shared";
import { SectionCard } from "@/components/entry/section-card";
import { formatMoney } from "@/lib/money";
import {
  roughEstimateForOffice,
  type RoughEstimateRule,
} from "@/lib/leads/rough-estimate";

/**
 * Office-only rough estimate from lot size. Wire onto the L01 lead detail when
 * `lead_requests` (and lot size from geocode) are available. Never mount on
 * public pages or customer emails.
 */
export function RoughEstimatePanel(props: {
  lotSqft: number | string | null | undefined;
  rules: readonly RoughEstimateRule[];
  orgRole: OrgRole | null | undefined;
}) {
  const result = roughEstimateForOffice(props);
  if (result.kind !== "estimate") return null;

  return (
    <SectionCard
      title="Rough estimate"
      weight="internal"
      heading="h3"
      mode="view"
      description={result.label}
      facts={[{ label: "Amount", value: formatMoney(result.amount), text: `${formatMoney(result.amount)} (${result.label})` }]}
    />
  );
}
