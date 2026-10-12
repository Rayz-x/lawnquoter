import type { Metadata } from "next";
import Link from "next/link";
import { hasRole } from "@lawnquoter/shared";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { OFFICE_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { dueForRenewal, renewalPrice } from "@/lib/agreements/renewal";
import { orgToday } from "@/lib/scheduling/office-date";
import { createClient } from "@/lib/supabase/server";
import { ProposeRenewalButton, RenewalRuleForm } from "./renewal-actions";

export const metadata: Metadata = { title: "Renewals" };

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function RenewalsPage() {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, OFFICE_ROLES)) {
    return (
      <>
        <PageHeader title="Renewals" />
        <div className="page-body">
          <Alert>
            <AlertTitle>Office only</AlertTitle>
            <AlertDescription>Renewals stay in the office.</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  const supabase = await createClient();
  const [{ data: org }, { data: rule, error: ruleError }, { data: agreements, error: agreementError }, { data: terms, error: termError }] =
    await Promise.all([
      supabase.from("orgs").select("timezone").eq("id", session.orgId).maybeSingle(),
      supabase.from("renewal_rules").select("increase_percent, window_days").eq("org_id", session.orgId).maybeSingle(),
      supabase
        .from("agreements")
        .select("id, end_date, status, accounts(name)")
        .eq("org_id", session.orgId)
        .eq("status", "active")
        .not("end_date", "is", null),
      supabase.from("agreement_price_terms").select("agreement_id, season_price_cents, effective_from").eq("org_id", session.orgId),
    ]);

  const error = ruleError?.message ?? agreementError?.message ?? termError?.message ?? null;
  const today = orgToday(org?.timezone ?? "America/Chicago");
  const percent = rule ? Number(rule.increase_percent) : 5;
  const windowDays = rule?.window_days ?? 30;
  const latestPrice = new Map<string, { cents: number; from: string }>();
  for (const term of terms ?? []) {
    const current = latestPrice.get(term.agreement_id);
    if (!current || term.effective_from > current.from) {
      latestPrice.set(term.agreement_id, { cents: term.season_price_cents, from: term.effective_from });
    }
  }
  const due = (agreements ?? []).flatMap((agreement) => {
    if (!agreement.end_date || !dueForRenewal(agreement.end_date, today, windowDays)) return [];
    const price = latestPrice.get(agreement.id);
    const proposed = price && rule ? renewalPrice(price.cents, percent) : null;
    const account = Array.isArray(agreement.accounts) ? agreement.accounts[0] : agreement.accounts;
    return [{ id: agreement.id, name: account?.name ?? "Account", endDate: agreement.end_date, prior: price?.cents ?? null, proposed }];
  });

  return (
    <>
      <PageHeader title="Renewals" description="Agreements ending inside the price-increase window." />
      <div className="page-body flex flex-col gap-6">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load renewals</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <RenewalRuleForm percent={String(percent)} windowDays={String(windowDays)} />
        {due.length === 0 ? <p className="text-sm text-muted-foreground">No agreements are due in this window.</p> : null}
        <ul className="flex flex-col gap-3">
          {due.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
              <div>
                <Link href={`/agreements/${row.id}`} className="font-semibold">
                  {row.name}
                </Link>
                <p className="text-sm text-muted-foreground">
                  Ends {row.endDate}
                  {row.prior != null && row.proposed != null ? ` · ${money(row.prior)} → ${money(row.proposed)}` : ""}
                </p>
              </div>
              <ProposeRenewalButton agreementId={row.id} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
