"use server";

import { revalidatePath } from "next/cache";
import { SALES_ROLES, hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { WEBSITE_FORM_SOURCE, parseLeadSource } from "@/lib/leads/lead-source";
import { createClient } from "@/lib/supabase/server";

async function editor() {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, SALES_ROLES)) return null;
  return session;
}

function unchanged(error: { message: string; code?: string } | null, rows: { id: string }[] | null): ActionResult | null {
  if (error?.code === "23503") return fail("Choose an existing account as the parent.");
  if (error) return fail(error.message);
  if (!rows?.length) return fail("Could not save. You may not have permission, or this record changed.");
  return null;
}

export type BillingDraft = {
  company_name: string;
  billing_email: string;
  billing_address_line1: string;
  billing_address_line2: string;
  billing_city: string;
  billing_region: string;
  billing_postal_code: string;
  net_terms_days: number;
  po_required: boolean;
  tax_exempt: boolean;
  consolidated_invoicing: boolean;
  parent_account_id: string;
};

export type SalesDraft = { lead_source: string; lead_source_other: string; tags: string };
export type NotesDraft = { notes: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function parentOf(orgId: string, id: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("accounts").select("parent_account_id").eq("id", id).eq("org_id", orgId).maybeSingle();
  return data?.parent_account_id ?? null;
}

async function parentIsCycle(orgId: string, accountId: string, parentId: string) {
  let current: string | null = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === accountId || seen.has(current)) return true;
    seen.add(current);
    current = await parentOf(orgId, current);
  }
  return false;
}

export async function updateAccountBilling(id: string, values: BillingDraft): Promise<ActionResult> {
  const session = await editor();
  if (!session) return fail("You don't have permission to edit customers.");
  const company = values.company_name.trim();
  const billingEmail = values.billing_email.trim();
  const line1 = values.billing_address_line1.trim();
  const line2 = values.billing_address_line2.trim();
  const city = values.billing_city.trim();
  const region = values.billing_region.trim();
  const postal = values.billing_postal_code.trim();
  const parentId = values.parent_account_id.trim();
  if (company.length > 200) return fail("Company name is too long.");
  if (billingEmail && !EMAIL.test(billingEmail)) return fail("Enter a valid billing email.");
  if (line1.length > 200 || line2.length > 200 || city.length > 100 || region.length > 100 || postal.length > 20) {
    return fail("Billing address is too long.");
  }
  if (line1 && (!city || !region || !postal)) return fail("Enter city, state, and ZIP for the billing address.");
  if (!Number.isInteger(values.net_terms_days) || values.net_terms_days < 0 || values.net_terms_days > 120) {
    return fail("Net days must be from 0 to 120.");
  }
  if (parentId === id) return fail("An account can't be its own parent.");
  if (parentId && (await parentIsCycle(session.orgId, id, parentId))) {
    return fail("A parent can't be this account or one of its sites.");
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .update({
      company_name: company || null,
      billing_email: billingEmail || null,
      billing_address_line1: line1 || null,
      billing_address_line2: line2 || null,
      billing_city: city || null,
      billing_region: region || null,
      billing_postal_code: postal || null,
      net_terms_days: values.net_terms_days,
      po_required: values.po_required,
      tax_exempt: values.tax_exempt,
      consolidated_invoicing: values.consolidated_invoicing,
      parent_account_id: parentId || null,
    })
    .eq("id", id)
    .eq("org_id", session.orgId)
    .select("id");
  const blocked = unchanged(error, data);
  if (blocked) return blocked;
  revalidatePath(`/accounts/${id}`);
  return { ok: true };
}

export async function updateAccountSales(id: string, values: SalesDraft): Promise<ActionResult> {
  const session = await editor();
  if (!session) return fail("You don't have permission to edit customers.");
  const tags = values.tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (tags.some((tag) => tag.length > 40)) return fail("Each tag must be 40 characters or less.");

  const supabase = await createClient();
  // Preserve system-set Website form when the rail only saves tags / other fields.
  if (values.lead_source.trim() === WEBSITE_FORM_SOURCE) {
    const { data, error } = await supabase
      .from("accounts")
      .update({ tags })
      .eq("id", id)
      .eq("org_id", session.orgId)
      .eq("lead_source", WEBSITE_FORM_SOURCE)
      .select("id");
    const blocked = unchanged(error, data);
    if (blocked) return blocked;
    revalidatePath(`/accounts/${id}`);
    return { ok: true };
  }

  const lead = parseLeadSource(values.lead_source, values.lead_source_other);
  if (!lead.ok) return fail(lead.error);

  const { data, error } = await supabase
    .from("accounts")
    .update({ lead_source: lead.lead_source, lead_source_other: lead.lead_source_other, tags })
    .eq("id", id)
    .eq("org_id", session.orgId)
    .select("id");
  const blocked = unchanged(error, data);
  if (blocked) return blocked;
  revalidatePath(`/accounts/${id}`);
  return { ok: true };
}

export async function updateAccountNotes(id: string, values: NotesDraft): Promise<ActionResult> {
  const session = await editor();
  if (!session) return fail("You don't have permission to edit customers.");
  const notes = values.notes.trim();
  if (notes.length > 5000) return fail("Notes are too long.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounts")
    .update({ notes: notes || null })
    .eq("id", id)
    .eq("org_id", session.orgId)
    .select("id");
  const blocked = unchanged(error, data);
  if (blocked) return blocked;
  revalidatePath(`/accounts/${id}`);
  return { ok: true };
}
