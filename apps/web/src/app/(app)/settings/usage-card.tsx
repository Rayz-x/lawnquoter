import { SectionCard } from "@/components/entry";

export function UsageCard({ imagerySessions, measurements }: { imagerySessions: number | null; measurements: number | null }) {
  const rows = [
    { label: "Imagery sessions", value: imagerySessions },
    { label: "Measurements", value: measurements },
  ];
  return (
    <SectionCard title="Usage" heading="h2" description="Imagery counts once each day the measure screen opens. Each saved measurement counts." className="w-full min-w-0">
      <dl className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.label} className="grid gap-0.5 lg:grid-cols-[11rem_minmax(0,1fr)] lg:items-center lg:gap-x-3">
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd className="text-sm tabular-nums">{row.value == null ? "Could not load usage." : row.value}</dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}
