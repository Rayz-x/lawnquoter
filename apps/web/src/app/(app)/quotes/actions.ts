"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function createQuote(accountId: string, propertyId?: string | null): Promise<ActionResult<{ id: string }>> {
  await requireOrg();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quote_create", {
    p_account: accountId,
    p_property: propertyId ?? undefined,
    p_title: "Service quote",
  });
  if (error || !data) return fail(error?.message ?? "Could not create quote");
  revalidatePath("/quotes");
  return { ok: true, data: { id: data } };
}

export async function createQuoteAndGo(accountId: string, propertyId?: string | null): Promise<void> {
  const r = await createQuote(accountId, propertyId);
  if (r.ok) redirect(`/quotes/${r.data.id}`);
  redirect(`/accounts/${accountId}`);
}

const itemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional().or(z.literal("")),
  state: z.enum(["included", "recommended", "optional"]).default("included"),
  option_group: z.string().max(80).optional().or(z.literal("")),
  option_tier: z.enum(["none", "good", "better", "best"]).default("none"),
  qty: z.coerce.number().positive().default(1),
  unit: z.string().max(20).default("each"),
  price: z.coerce.number().nonnegative().default(0),
  hours: z.coerce.number().nonnegative().default(0),
  cost: z.coerce.number().nonnegative().default(0),
  range_low: z.coerce.number().nonnegative().optional().or(z.literal("")),
  range_high: z.coerce.number().nonnegative().optional().or(z.literal("")),
  photo_url: z.string().url().optional().or(z.literal("")),
  notes_customer: z.string().max(2000).optional().or(z.literal("")),
  notes_crew: z.string().max(2000).optional().or(z.literal("")),
});

export async function addLineItem(quoteId: string, versionId: string, fd: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  const parsed = itemSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { error } = await supabase.from("quote_line_items").insert({
    org_id: session.orgId,
    version_id: versionId,
    name: parsed.data.name,
    description: parsed.data.description || null,
    state: parsed.data.state,
    option_group: parsed.data.option_group || null,
    option_tier: parsed.data.option_tier,
    qty: parsed.data.qty,
    unit: parsed.data.unit,
    price: parsed.data.price,
    hours: parsed.data.hours,
    cost: parsed.data.cost,
    range_low: parsed.data.range_low === "" || parsed.data.range_low == null ? null : Number(parsed.data.range_low),
    range_high: parsed.data.range_high === "" || parsed.data.range_high == null ? null : Number(parsed.data.range_high),
    photo_url: parsed.data.photo_url || null,
    notes_customer: parsed.data.notes_customer || null,
    notes_crew: parsed.data.notes_crew || null,
    selected: parsed.data.state === "included",
  });
  if (error) return fail(error.message);
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true };
}

export async function deleteLineItem(quoteId: string, id: string): Promise<ActionResult> {
  const session = await requireOrg();
  const supabase = await createClient();
  const { error } = await supabase.from("quote_line_items").delete().eq("id", id).eq("org_id", session.orgId);
  if (error) return fail(error.message);
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true };
}

export async function updateQuoteMeta(id: string, fd: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  const parsed = z
    .object({
      title: z.string().trim().min(1).max(200),
      intro: z.string().max(4000).optional().or(z.literal("")),
      notes_customer: z.string().max(4000).optional().or(z.literal("")),
      notes_internal: z.string().max(4000).optional().or(z.literal("")),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { error } = await supabase
    .from("quotes")
    .update({
      title: parsed.data.title,
      intro: parsed.data.intro || null,
      notes_customer: parsed.data.notes_customer || null,
      notes_internal: parsed.data.notes_internal || null,
    })
    .eq("id", id)
    .eq("org_id", session.orgId);
  if (error) return fail(error.message);
  revalidatePath(`/quotes/${id}`);
  return { ok: true };
}

export async function sendQuote(id: string): Promise<ActionResult<{ url: string }>> {
  const session = await requireOrg();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quotes")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id)
    .eq("org_id", session.orgId)
    .select("public_token")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not send");
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  revalidatePath(`/quotes/${id}`);
  return { ok: true, data: { url: `${base}/q/${data.public_token}` } };
}

export async function addPricedService(quoteId: string, versionId: string, fd: FormData): Promise<ActionResult> {
  const session = await requireOrg();
  const parsed = z
    .object({
      name: z.string().min(1),
      price: z.coerce.number(),
      hours: z.coerce.number(),
      cost: z.coerce.number(),
      range_low: z.coerce.number().optional().or(z.literal("")),
      range_high: z.coerce.number().optional().or(z.literal("")),
      state: z.enum(["included", "recommended", "optional"]).default("included"),
      option_group: z.string().optional().or(z.literal("")),
      option_tier: z.enum(["none", "good", "better", "best"]).default("none"),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { error } = await supabase.from("quote_line_items").insert({
    org_id: session.orgId,
    version_id: versionId,
    name: parsed.data.name,
    price: parsed.data.price,
    hours: parsed.data.hours,
    cost: parsed.data.cost,
    range_low: parsed.data.range_low === "" || parsed.data.range_low == null ? null : Number(parsed.data.range_low),
    range_high: parsed.data.range_high === "" || parsed.data.range_high == null ? null : Number(parsed.data.range_high),
    state: parsed.data.state,
    option_group: parsed.data.option_group || null,
    option_tier: parsed.data.option_tier,
    selected: parsed.data.state === "included",
  });
  if (error) return fail(error.message);
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true };
}
