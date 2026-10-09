"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const convertedSchema = z.object({
  agreement_id: idSchema,
  job_id: idSchema,
});

export async function convertAcceptedQuote(
  quoteId: string,
): Promise<ActionResult<{ agreementId: string; jobId: string }>> {
  await requireOrg();
  const parsed = idSchema.safeParse(quoteId);
  if (!parsed.success) return fail("Invalid quote");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("convert_accepted_quote", { p_quote_id: parsed.data });
  if (error || data == null) return fail(error?.message ?? "Could not convert quote");
  const body = convertedSchema.safeParse(data);
  if (!body.success) return fail("Could not convert quote");
  return { ok: true, data: { agreementId: body.data.agreement_id, jobId: body.data.job_id } };
}

export async function generateVisits(
  agreementId: string,
  throughDate: string,
): Promise<ActionResult<{ created: number }>> {
  await requireOrg();
  const parsed = z.object({ agreementId: idSchema, throughDate: dateSchema }).safeParse({ agreementId, throughDate });
  if (!parsed.success) return fail("Invalid agreement");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("generate_agreement_visits", {
    p_agreement_id: parsed.data.agreementId,
    p_through: parsed.data.throughDate,
  });
  if (error || data == null) return fail(error?.message ?? "Could not generate visits");
  return { ok: true, data: { created: data } };
}

export async function assignVisit(input: {
  visitId: string;
  crewId: string;
  date: string;
  sort?: number;
}): Promise<ActionResult<{ routeId: string }>> {
  await requireOrg();
  const parsed = z
    .object({
      visitId: idSchema,
      crewId: idSchema,
      date: dateSchema,
      sort: z.number().int().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid visit assignment");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_visit", {
    p_visit_id: parsed.data.visitId,
    p_crew_id: parsed.data.crewId,
    p_service_date: parsed.data.date,
    p_sort: parsed.data.sort ?? 0,
  });
  if (error || data == null) return fail(error?.message ?? "Could not assign visit");
  return { ok: true, data: { routeId: data } };
}

export async function reorderVisits(routeId: string, visitIds: string[]): Promise<ActionResult> {
  await requireOrg();
  const parsed = z.object({ routeId: idSchema, visitIds: z.array(idSchema).min(1) }).safeParse({ routeId, visitIds });
  if (!parsed.success) return fail("Invalid route order");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_route_visits", {
    p_route_id: parsed.data.routeId,
    p_visit_ids: parsed.data.visitIds,
  });
  if (error) return fail(error.message);
  return { ok: true };
}

export async function publishRoute(routeId: string): Promise<ActionResult<{ publishedAt: string }>> {
  await requireOrg();
  const parsed = idSchema.safeParse(routeId);
  if (!parsed.success) return fail("Invalid route");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_route", { p_route_id: parsed.data });
  if (error || data == null) return fail(error?.message ?? "Could not publish route");
  return { ok: true, data: { publishedAt: data } };
}

export async function createCrew(name: string): Promise<ActionResult<{ crewId: string }>> {
  await requireOrg();
  const parsed = z.string().trim().min(1).max(80).safeParse(name);
  if (!parsed.success) return fail("Crew name is required");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_crew", { p_name: parsed.data });
  if (error || data == null) return fail(error?.message ?? "Could not create crew");
  return { ok: true, data: { crewId: data } };
}

export async function addCrewMember(crewId: string, profileId: string): Promise<ActionResult> {
  await requireOrg();
  const parsed = z.object({ crewId: idSchema, profileId: idSchema }).safeParse({ crewId, profileId });
  if (!parsed.success) return fail("Invalid crew member");
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_crew_member", {
    p_crew_id: parsed.data.crewId,
    p_profile_id: parsed.data.profileId,
  });
  if (error) return fail(error.message);
  return { ok: true };
}
