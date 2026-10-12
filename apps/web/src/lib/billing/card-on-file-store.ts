import "server-only";

import type { createAdminClient } from "@/lib/supabase/server";
import type { SavedCard } from "./card-on-file";
import type { CardSetupStore } from "./card-on-file-webhook";

type AdminClient = ReturnType<typeof createAdminClient>;

export function createCardOnFileStore(admin: AdminClient): CardSetupStore {
  return {
    async claimEvent(eventId, orgId) {
      const { error } = await admin.from("stripe_events").insert({
        stripe_event_id: eventId,
        event_type: "checkout.session.completed",
        org_id: orgId,
        payload: {},
        processed_at: new Date().toISOString(),
      });
      if (error?.code === "23505") return { claimed: false };
      if (error) throw new Error(error.message);
      return { claimed: true };
    },
    async hasCard(accountId) {
      const { count, error } = await admin
        .from("account_payment_methods")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId);
      if (error) throw new Error(error.message);
      return (count ?? 0) > 0;
    },
    async saveCard(input) {
      await upsertSavedCard(admin, input);
    },
  };
}

export async function upsertSavedCard(
  admin: AdminClient,
  input: { orgId: string; accountId: string; card: SavedCard; makeDefault: boolean },
) {
  const { data: existing, error: existingError } = await admin
    .from("account_payment_methods")
    .select("id")
    .eq("stripe_payment_method_id", input.card.stripePaymentMethodId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    const { error } = await admin
      .from("account_payment_methods")
      .update({
        brand: input.card.brand,
        last4: input.card.last4,
        exp_month: input.card.expMonth,
        exp_year: input.card.expYear,
        kind: input.card.kind,
      })
      .eq("id", existing.id)
      .eq("org_id", input.orgId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from("account_payment_methods").insert({
      org_id: input.orgId,
      account_id: input.accountId,
      stripe_customer_id: input.card.stripeCustomerId,
      stripe_payment_method_id: input.card.stripePaymentMethodId,
      kind: input.card.kind,
      brand: input.card.brand,
      last4: input.card.last4,
      exp_month: input.card.expMonth,
      exp_year: input.card.expYear,
      is_default: input.makeDefault,
    });
    if (error) throw new Error(error.message);
  }
  const { error: customerError } = await admin
    .from("accounts")
    .update({ stripe_customer_id: input.card.stripeCustomerId })
    .eq("id", input.accountId)
    .eq("org_id", input.orgId);
  if (customerError) throw new Error(customerError.message);
}
