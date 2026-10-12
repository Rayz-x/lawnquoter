import { SectionCard } from "@/components/entry";
import { HelpTip } from "@/components/help/help-tip";
import { leadConnectorStates, type LeadConnectorState } from "@/lib/leads/inbound";

export function LeadConnectorsCard({
  isOwner,
  states = leadConnectorStates(process.env),
}: {
  isOwner: boolean;
  states?: LeadConnectorState[];
}) {
  if (!isOwner) return null;
  return (
    <SectionCard
      title="Lead connectors"
      heading="h2"
      description="Each source stays off until its key is set. Nothing is fetched or charged before then."
      className="w-full min-w-0"
    >
      <HelpTip
        label="Help for lead connectors"
        text="Each source stays off until its key is set. Nothing is fetched or charged before then."
        href="/help/integrations#lead-connectors"
      />
      <ul className="grid gap-2">
        {states.map((state) => (
          <li key={state.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">{state.label}</span>
            <span className={state.connected ? "text-success" : "text-muted-foreground"}>{state.message}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
