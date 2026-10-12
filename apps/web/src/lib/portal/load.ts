import "server-only";

import { createAdminClient } from "@/lib/supabase/server";
import { cardPortalRequest, customerVisibleQuote, portalScope, upcomingVisits } from "./scope";

const TOKEN = /^[0-9a-f-]{36}$/i;

export type PortalView = {
  token: string;
  orgName: string;
  accountName: string;
  sites: { id: string; name: string; properties: { id: string; label: string }[] }[];
  properties: { id: string; accountId: string; label: string }[];
  quotes: { id: string; label: string; status: string; href: string }[];
  invoices: { id: string; label: string; status: string; href: string | null }[];
  visits: { id: string; label: string; when: string }[];
  photos: { id: string; url: string; kind: string }[];
  requests: { id: string; body: string; createdAt: string }[];
  cardHref: string | null;
  cardMessage: string | null;
};

type OpenLink = {
  id: string;
  orgId: string;
  accountId: string;
  stripeCustomerId: string | null;
  stripeAccountId: string | null;
  accountName: string;
  orgName: string;
  accounts: { id: string; name: string; parentAccountId: string | null }[];
};

async function openLink(token: string): Promise<OpenLink | null> {
  if (!TOKEN.test(token)) return null;
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("portal_links")
    .select("id, org_id, account_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!link || new Date(link.expires_at).getTime() <= Date.now()) return null;
  const [{ data: root }, { data: children }, { data: org }, { data: connect }] = await Promise.all([
    admin.from("accounts").select("id, name, parent_account_id, stripe_customer_id").eq("id", link.account_id).eq("org_id", link.org_id).maybeSingle(),
    admin.from("accounts").select("id, name, parent_account_id").eq("org_id", link.org_id).eq("parent_account_id", link.account_id),
    admin.from("orgs").select("name").eq("id", link.org_id).maybeSingle(),
    admin.from("org_stripe_connect").select("stripe_account_id").eq("org_id", link.org_id).maybeSingle(),
  ]);
  if (!root) return null;
  return {
    id: link.id,
    orgId: link.org_id,
    accountId: link.account_id,
    stripeCustomerId: root.stripe_customer_id,
    stripeAccountId: connect?.stripe_account_id ?? null,
    accountName: root.name,
    orgName: org?.name ?? "Your company",
    accounts: [
      { id: root.id, name: root.name, parentAccountId: root.parent_account_id },
      ...(children ?? []).map((child) => ({ id: child.id, name: child.name, parentAccountId: child.parent_account_id })),
    ],
  };
}

export async function loadPortalAccess(token: string) {
  const link = await openLink(token);
  if (!link) return null;
  return { stripeCustomerId: link.stripeCustomerId, stripeAccountId: link.stripeAccountId };
}

export async function loadPortal(token: string): Promise<PortalView | null> {
  const link = await openLink(token);
  if (!link) return null;
  const admin = createAdminClient();
  const accountIds = portalScope(link.accountId, link.accounts);
  const { data: propertyRows } = await admin
    .from("properties")
    .select("id, account_id, name, formatted_address")
    .eq("org_id", link.orgId)
    .in("account_id", accountIds);
  const properties = (propertyRows ?? []).map((property) => ({
    id: property.id,
    accountId: property.account_id,
    label: property.name || property.formatted_address || "Property",
  }));
  const propertyIds = properties.map((property) => property.id);
  const [{ data: quoteRows }, { data: invoiceRows }, { data: visitRows }, { data: requestRows }] = await Promise.all([
    admin.from("quotes").select("id, number, title, status, public_token").eq("org_id", link.orgId).in("account_id", accountIds).order("updated_at", { ascending: false }).limit(50),
    admin.from("invoices").select("id, number_label, status, public_token").eq("org_id", link.orgId).in("account_id", accountIds).in("status", ["issued", "paid"]).order("created_at", { ascending: false }).limit(30),
    propertyIds.length === 0
      ? Promise.resolve({ data: [] as { id: string; scheduled_date: string | null; occurrence_date: string; status: string }[] })
      : admin.from("visits").select("id, scheduled_date, occurrence_date, status").eq("org_id", link.orgId).in("property_id", propertyIds).order("occurrence_date", { ascending: false }).limit(40),
    admin.from("portal_requests").select("id, body, created_at").eq("portal_link_id", link.id).order("created_at", { ascending: false }).limit(10),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const visits = upcomingVisits(
    (visitRows ?? []).map((visit) => ({
      id: visit.id,
      scheduledDate: visit.scheduled_date,
      occurrenceDate: visit.occurrence_date,
      status: visit.status,
      label: visit.status,
      when: visit.scheduled_date ?? visit.occurrence_date,
    })),
    today,
  );
  const visitIds = (visitRows ?? []).map((visit) => visit.id);
  const { data: photoRows } =
    visitIds.length === 0
      ? { data: [] as { id: string; storage_path: string; kind: string }[] }
      : await admin.from("visit_photos").select("id, storage_path, kind").eq("org_id", link.orgId).in("visit_id", visitIds).order("taken_at", { ascending: false }).limit(12);
  const photos: PortalView["photos"] = [];
  for (const photo of photoRows ?? []) {
    const signed = await admin.storage.from("visit-photos").createSignedUrl(photo.storage_path, 1800);
    if (signed.data?.signedUrl) photos.push({ id: photo.id, url: signed.data.signedUrl, kind: photo.kind });
  }
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const card = cardPortalRequest({
    stripeCustomerId: link.stripeCustomerId,
    stripeAccountId: link.stripeAccountId,
    returnUrl: `${origin}/portal/${token}`,
  });
  const names = new Map(link.accounts.map((account) => [account.id, account.name]));
  return {
    token,
    orgName: link.orgName,
    accountName: link.accountName,
    sites: accountIds.map((id) => ({
      id,
      name: names.get(id) ?? "Site",
      properties: properties.filter((property) => property.accountId === id),
    })),
    properties,
    quotes: (quoteRows ?? []).filter((quote) => customerVisibleQuote(quote.status)).map((quote) => ({
      id: quote.id,
      label: `#${quote.number} ${quote.title}`,
      status: quote.status,
      href: `/q/${quote.public_token}`,
    })),
    invoices: (invoiceRows ?? []).map((invoice) => ({
      id: invoice.id,
      label: invoice.number_label ?? "Invoice",
      status: invoice.status,
      href: invoice.status === "issued" ? `/i/${invoice.public_token}` : null,
    })),
    visits: visits.map((visit) => ({ id: visit.id, label: visit.label, when: visit.when })),
    photos,
    requests: (requestRows ?? []).map((request) => ({ id: request.id, body: request.body, createdAt: request.created_at.slice(0, 10) })),
    cardHref: card.ok ? `/portal/${token}/card` : null,
    cardMessage: card.ok ? null : card.message,
  };
}
