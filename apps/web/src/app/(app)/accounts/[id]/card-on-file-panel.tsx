import { ADMIN_ROLES, hasRole, type OrgRole } from "@lawnquoter/shared";
import { createClient } from "@/lib/supabase/server";
import { captureCardSetupReturn } from "./card-on-file-actions";
import { CardOnFileCard, type CardOnFileRow } from "./card-on-file-card";

export async function CardOnFilePanel({
  accountId,
  orgId,
  role,
  returnSessionId,
}: {
  accountId: string;
  orgId: string;
  role: OrgRole;
  returnSessionId: string | null;
}) {
  if (!hasRole(role, ADMIN_ROLES)) return null;
  const supabase = await createClient();
  const [{ data: methods, error }, { data: connect }, { data: account }] = await Promise.all([
    supabase
      .from("account_payment_methods")
      .select("id, brand, last4, kind, is_default")
      .eq("account_id", accountId)
      .eq("org_id", orgId)
      .order("created_at"),
    supabase.from("org_stripe_connect").select("status, charges_enabled").eq("org_id", orgId).maybeSingle(),
    supabase.from("accounts").select("auto_charge").eq("id", accountId).eq("org_id", orgId).maybeSingle(),
  ]);
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  let notice: string | null = null;
  if (returnSessionId) {
    const saved = await captureCardSetupReturn({ accountId, orgId, sessionId: returnSessionId });
    notice = saved.ok ? "Card saved." : saved.error;
  }
  const rows: CardOnFileRow[] = (methods ?? []).map((method) => ({
    id: method.id,
    brand: method.brand,
    last4: method.last4,
    kind: method.kind === "us_bank_account" ? "us_bank_account" : "card",
    isDefault: method.is_default,
  }));
  return (
    <CardOnFileCard
      accountId={accountId}
      stripeKey={Boolean(process.env.STRIPE_SECRET_KEY)}
      connectReady={connect?.status === "ready" && Boolean(connect.charges_enabled)}
      methods={rows}
      notice={notice}
      autoCharge={account?.auto_charge === true}
    />
  );
}
