import Link from "next/link";
import { SectionCard } from "@/components/entry";
import type { ParentRollup } from "@/lib/accounts/parent-rollup";
import { formatMoney } from "@/lib/money";

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function ParentRollupCard({ rollup }: { rollup: ParentRollup }) {
  const { totals } = rollup;
  return (
    <SectionCard title="Across accounts" heading="h3">
      <p className="text-sm text-muted-foreground">
        {countLabel(totals.sites, "account", "accounts")}
        {" · "}
        {countLabel(totals.openQuotes, "open quote", "open quotes")}
        {" · "}
        {formatMoney(totals.issuedCents / 100, { cents: true })} issued
        {" · "}
        {countLabel(totals.jobs, "job", "jobs")}
      </p>
      <ul className="flex flex-col gap-2">
        {rollup.sites.map((site) => (
          <li key={site.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Link href={`/accounts/${site.id}`} className="font-medium underline">
              {site.name}
            </Link>
            <span className="text-muted-foreground">
              {countLabel(site.openQuotes, "open quote", "open quotes")}
              {" · "}
              {formatMoney(site.issuedCents / 100, { cents: true })}
              {" · "}
              {countLabel(site.properties, "property", "properties")}
              {" · "}
              {countLabel(site.jobs, "job", "jobs")}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
