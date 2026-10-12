"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SALES_ROLES, hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { isQuoteTemplateKind, quoteTemplateConfig, readQuoteTemplateConfig } from "@/lib/quotes/template-config";
import { createClient } from "@/lib/supabase/server";

const saveSchema = z.object({
  quoteId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  serviceKind: z.string(),
});

async function currentVersion(quoteId: string) {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, SALES_ROLES)) return fail("You do not have access to edit quotes.");
  const supabase = await createClient();
  const { data: versionId, error } = await supabase.rpc("quote_current_version", { p_quote: quoteId });
  if (error || !versionId) return fail(error?.message ?? "Could not read this quote");
  return { ok: true as const, session, supabase, versionId };
}

export async function saveQuoteTemplate(input: z.infer<typeof saveSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid template");
  const serviceKind = parsed.data.serviceKind === "" ? null : parsed.data.serviceKind;
  if (serviceKind && !isQuoteTemplateKind(serviceKind)) return fail("Pick a service line.");
  const current = await currentVersion(parsed.data.quoteId);
  if (!current.ok) return current;
  const [{ data: sections, error: sectionError }, { data: items, error: itemError }] = await Promise.all([
    current.supabase.from("quote_sections").select("id, title").eq("version_id", current.versionId),
    current.supabase
      .from("quote_line_items")
      .select("section_id, name, description, state, qty, unit, price, sort")
      .eq("version_id", current.versionId),
  ]);
  if (sectionError || itemError) return fail(sectionError?.message ?? itemError?.message ?? "Could not read this quote");
  const config = quoteTemplateConfig({ sections: sections ?? [], items: items ?? [] });
  if (!config.lines.length) return fail("Add a line before saving a template.");
  const { data, error } = await current.supabase
    .from("quote_templates")
    .insert({
      org_id: current.session.orgId,
      name: parsed.data.name,
      service_kind: serviceKind && isQuoteTemplateKind(serviceKind) ? serviceKind : null,
      config,
    })
    .select("id")
    .single();
  if (error || !data) return fail(error?.message ?? "Could not save the template");
  revalidatePath(`/quotes/${parsed.data.quoteId}`);
  return { ok: true, data: { id: data.id } };
}

export async function applyQuoteTemplate(quoteId: string, templateId: string): Promise<ActionResult<{ count: number }>> {
  if (!z.string().uuid().safeParse(quoteId).success || !z.string().uuid().safeParse(templateId).success) {
    return fail("Invalid template");
  }
  const current = await currentVersion(quoteId);
  if (!current.ok) return current;
  const { data: template, error } = await current.supabase
    .from("quote_templates")
    .select("config")
    .eq("id", templateId)
    .eq("org_id", current.session.orgId)
    .maybeSingle();
  if (error || !template) return fail(error?.message ?? "Template not found");
  const config = readQuoteTemplateConfig(template.config);
  if (!config) return fail("This template has no lines.");
  const { data: sections, error: sectionError } = await current.supabase
    .from("quote_sections")
    .select("id, title")
    .eq("version_id", current.versionId);
  if (sectionError) return fail(sectionError.message);
  const sectionId = new Map((sections ?? []).map((section) => [section.title, section.id]));
  let count = 0;
  for (const line of config.lines) {
    let target = sectionId.get(line.section);
    if (!target) {
      const created = await current.supabase
        .from("quote_sections")
        .insert({ org_id: current.session.orgId, version_id: current.versionId, title: line.section, sort: sectionId.size })
        .select("id")
        .single();
      if (created.error || !created.data) return fail(created.error?.message ?? "Could not add a section");
      target = created.data.id;
      sectionId.set(line.section, target);
    }
    const inserted = await current.supabase.from("quote_line_items").insert({
      org_id: current.session.orgId,
      version_id: current.versionId,
      section_id: target,
      name: line.name,
      description: line.description,
      state: line.state,
      qty: line.qty,
      unit: line.unit,
      price: line.price,
      selected: line.state === "included",
      quantity_source: "manual",
      site_check_reasons: [],
      sort: count,
    });
    if (inserted.error) return fail(inserted.error.message);
    count += 1;
  }
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true, data: { count } };
}
