"use server";

import { revalidatePath } from "next/cache";
import { hasRole, SALES_ROLES } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { CUSTOMER_EDIT_ROLES } from "@/lib/auth/office-roles";
import { requireOrg } from "@/lib/auth/session";
import { invoicePublicPath } from "@/lib/billing/payment-reminders";
import { formatMoney } from "@/lib/money";
import { defaultSelectedIds } from "@/lib/quotes/selection";
import { createClient } from "@/lib/supabase/server";
import { documentSms, pickSmsContact, type TextRecipient } from "./document-sms";
import { claimedSmsFrom, deliverSms, readTwilioConfig, toE164, TWILIO_NOT_CONNECTED } from "./sms";

type Purpose = "quote" | "invoice";

function label(value: { name?: string | null } | { name?: string | null }[] | null | undefined): string {
  const row = Array.isArray(value) ? value[0] : value;
  return row?.name?.trim() || "";
}

function addressOf(value: { formatted_address?: string | null } | { formatted_address?: string | null }[] | null | undefined): string {
  const row = Array.isArray(value) ? value[0] : value;
  return row?.formatted_address?.trim() || "";
}

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

async function messagingBits(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  accountId: string,
  purpose: Purpose,
) {
  const [{ data: org }, { data: template }, { data: contacts, error }] = await Promise.all([
    supabase.from("orgs").select("name, sms_number").eq("id", orgId).maybeSingle(),
    supabase.from("message_templates").select("body").eq("org_id", orgId).eq("channel", "sms").eq("purpose", purpose).eq("is_default", true).maybeSingle(),
    supabase.from("contacts").select("id, phone, sms_opt_in").eq("org_id", orgId).eq("account_id", accountId),
  ]);
  if (error) return { error: error.message as string, org: null, templateBody: null as string | null, contact: null as TextRecipient | null };
  const numbers = (contacts ?? []).map((contact) => toE164(contact.phone ?? "")).filter((phone): phone is string => Boolean(phone));
  const inbound = numbers.length
    ? await supabase.from("messages").select("from_address").eq("org_id", orgId).eq("channel", "sms").eq("direction", "in").in("from_address", numbers)
    : { data: [], error: null };
  if (inbound.error) return { error: inbound.error.message, org: null, templateBody: null, contact: null };
  return {
    error: null,
    org,
    templateBody: template?.body ?? null,
    contact: pickSmsContact(
      (contacts ?? []).map((contact) => ({ id: contact.id, phone: contact.phone, smsOptIn: contact.sms_opt_in })),
      (inbound.data ?? []).map((row) => row.from_address),
    ),
  };
}

export async function textDocument(input: { purpose: Purpose; id: string }): Promise<ActionResult> {
  const session = await requireOrg();
  const purpose = input.purpose;
  if (purpose !== "quote" && purpose !== "invoice") return fail("Choose a quote or an invoice.");
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return fail("That record was not found.");
  const allowed = purpose === "quote" ? SALES_ROLES : CUSTOMER_EDIT_ROLES;
  if (!hasRole(session.orgRole, allowed)) return fail(purpose === "quote" ? "You do not have access to edit quotes." : "You cannot send texts.");

  const supabase = await createClient();
  const loaded = purpose === "quote" ? await loadQuote(supabase, session.orgId, input.id) : await loadInvoice(supabase, session.orgId, input.id);
  if (!loaded.ok) return loaded;

  const config = readTwilioConfig(process.env);
  const composed = documentSms({
    purpose,
    status: loaded.data.status,
    templateBody: loaded.data.templateBody,
    customerName: loaded.data.customerName,
    company: loaded.data.company,
    link: loaded.data.link,
    amount: loaded.data.amount,
    address: loaded.data.address,
    contact: loaded.data.contact,
    connected: config !== null,
  });
  if (!composed.ok) return composed;
  if (!config) return fail(TWILIO_NOT_CONNECTED);

  const from = claimedSmsFrom(loaded.data.smsNumber);
  if (!from) return fail("Set the company's texting number in Texts before sending.");
  const delivery = await deliverSms({ config, to: composed.to, from, body: composed.body, fetch: (url, init) => fetch(url, init) });
  const { data: activity, error: activityError } = await supabase
    .from("activities")
    .insert({
      org_id: session.orgId,
      account_id: loaded.data.accountId,
      property_id: loaded.data.propertyId,
      actor_id: session.userId,
      kind: "sms.out",
      summary: delivery.sent ? `Text to ${composed.to}` : `Text to ${composed.to} failed`,
      meta: { to: composed.to, quote_id: purpose === "quote" ? input.id : null, invoice_id: purpose === "invoice" ? input.id : null },
    })
    .select("id")
    .single();
  if (activityError || !activity) return fail(activityError?.message ?? "Could not record the text.");
  const { error } = await supabase.from("messages").insert({
    org_id: session.orgId,
    channel: "sms",
    direction: "out",
    status: delivery.sent ? "sent" : "failed",
    from_address: from,
    to_address: composed.to,
    body: composed.body,
    provider: "twilio",
    provider_id: delivery.sent ? delivery.sid : null,
    error: delivery.sent ? null : "Twilio rejected the text",
    account_id: loaded.data.accountId,
    contact_id: loaded.data.contactId,
    quote_id: purpose === "quote" ? input.id : null,
    invoice_id: purpose === "invoice" ? input.id : null,
    activity_id: activity.id,
  });
  if (error) return fail(error.message);
  if (!delivery.sent) {
    revalidatePath("/inbox");
    return fail("Twilio rejected the text.");
  }
  if (loaded.data.needsSend) {
    const { error: sendError } = await supabase.rpc("quote_send", { p_quote: input.id });
    if (sendError) return fail(sendError.message);
  }
  revalidatePath(purpose === "quote" ? `/quotes/${input.id}` : `/invoices/${input.id}`);
  revalidatePath("/inbox");
  return { ok: true };
}

type Loaded = {
  accountId: string;
  propertyId: string | null;
  contactId: string | null;
  status: string;
  needsSend: boolean;
  customerName: string;
  company: string;
  address: string;
  link: string | null;
  amount: string;
  templateBody: string | null;
  smsNumber: string | null;
  contact: TextRecipient | null;
};

async function loadQuote(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, id: string): Promise<ActionResult<Loaded>> {
  const { data: quote, error } = await supabase
    .from("quotes")
    .select("status, public_token, account_id, property_id, accounts(name), properties(formatted_address)")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!quote) return fail("Quote not found");
  const { data: versionId, error: versionError } = await supabase.rpc("quote_current_version", { p_quote: id });
  if (versionError) return fail(versionError.message);
  const lines = versionId
    ? await supabase.from("quote_line_items").select("id, state, option_group, selected, price").eq("org_id", orgId).eq("version_id", versionId)
    : { data: [], error: null };
  if (lines.error) return fail(lines.error.message);
  const picked = new Set(defaultSelectedIds(lines.data ?? []));
  const total = (lines.data ?? []).filter((line) => picked.has(line.id)).reduce((sum, line) => sum + Number(line.price ?? 0), 0);
  const bits = await messagingBits(supabase, orgId, quote.account_id, "quote");
  if (bits.error) return fail(bits.error);
  return {
    ok: true,
    data: {
      accountId: quote.account_id,
      propertyId: quote.property_id,
      contactId: bits.contact?.id ?? null,
      status: quote.status,
      needsSend: quote.status === "draft" || quote.status === "changed",
      customerName: label(quote.accounts) || "there",
      company: bits.org?.name ?? "us",
      address: addressOf(quote.properties),
      link: `${appBase()}/q/${quote.public_token}`,
      amount: formatMoney(total, { cents: true }),
      templateBody: bits.templateBody,
      smsNumber: bits.org?.sms_number ?? null,
      contact: bits.contact,
    },
  };
}

async function loadInvoice(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, id: string): Promise<ActionResult<Loaded>> {
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("status, public_token, account_id, property_id, total_cents, accounts(name), properties(formatted_address)")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!invoice) return fail("Invoice not found");
  const path = invoicePublicPath(invoice.public_token);
  const bits = await messagingBits(supabase, orgId, invoice.account_id, "invoice");
  if (bits.error) return fail(bits.error);
  return {
    ok: true,
    data: {
      accountId: invoice.account_id,
      propertyId: invoice.property_id,
      contactId: bits.contact?.id ?? null,
      status: invoice.status,
      needsSend: false,
      customerName: label(invoice.accounts) || "there",
      company: bits.org?.name ?? "us",
      address: addressOf(invoice.properties),
      link: path ? `${appBase()}${path}` : null,
      amount: formatMoney(invoice.total_cents / 100, { cents: true }),
      templateBody: bits.templateBody,
      smsNumber: bits.org?.sms_number ?? null,
      contact: bits.contact,
    },
  };
}
