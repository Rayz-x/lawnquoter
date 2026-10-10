"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const kindSchema = z.enum(["one_time", "recurring"]);
const frequencySchema = z.enum(["weekly", "biweekly", "monthly"]);

const convertedSchema = z.object({
  agreement_id: idSchema,
  job_id: idSchema,
});

const convertInputSchema = z
  .object({
    kind: kindSchema,
    frequency: frequencySchema.optional(),
    preferredDow: z.number().int().min(0).max(6).optional(),
    startDate: dateSchema,
  })
  .superRefine((input, ctx) => {
    if (input.kind !== "recurring") return;
    if (!input.frequency) {
      ctx.addIssue({ code: "custom", message: "Recurring agreements need a frequency" });
    }
    if (input.preferredDow == null) {
      ctx.addIssue({ code: "custom", message: "Recurring agreements need a preferred day" });
    }
  });

export type ConvertQuoteInput = z.infer<typeof convertInputSchema>;

export async function convertAcceptedQuote(
  quoteId: string,
  input: ConvertQuoteInput,
): Promise<ActionResult<{ agreementId: string; jobId: string }>> {
  await requireOrg();
  const parsed = z.object({ quoteId: idSchema, input: convertInputSchema }).safeParse({ quoteId, input });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid quote");
  const recurring = parsed.data.input.kind === "recurring";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("convert_accepted_quote", {
    p_quote_id: parsed.data.quoteId,
    p_kind: parsed.data.input.kind,
    p_start_date: parsed.data.input.startDate,
    ...(recurring
      ? {
          p_frequency: parsed.data.input.frequency,
          p_preferred_dow: parsed.data.input.preferredDow,
        }
      : {}),
  });
  if (error || data == null) return fail(error?.message ?? "Could not convert quote");
  const body = convertedSchema.safeParse(data);
  if (!body.success) return fail("Could not convert quote");
  return { ok: true, data: { agreementId: body.data.agreement_id, jobId: body.data.job_id } };
}

export async function updateAgreementSchedule(input: {
  agreementId: string;
  kind: "one_time" | "recurring";
  frequency?: "weekly" | "biweekly" | "monthly";
  preferredDow?: number;
  startDate: string;
}): Promise<ActionResult> {
  const session = await requireOrg();
  const parsed = z
    .object({
      agreementId: idSchema,
      kind: kindSchema,
      frequency: frequencySchema.optional(),
      preferredDow: z.number().int().min(0).max(6).optional(),
      startDate: dateSchema,
    })
    .superRefine((value, ctx) => {
      if (value.kind !== "recurring") return;
      if (!value.frequency) ctx.addIssue({ code: "custom", message: "Recurring agreements need a frequency" });
      if (value.preferredDow == null) {
        ctx.addIssue({ code: "custom", message: "Recurring agreements need a preferred day" });
      }
    })
    .safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid agreement");

  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("agreements")
    .select("id, status, end_date")
    .eq("id", parsed.data.agreementId)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (loadError) return fail(loadError.message);
  if (!existing) return fail("Agreement not found");
  if (existing.status === "ended") return fail("Ended agreements cannot be changed");
  if (existing.end_date && existing.end_date < parsed.data.startDate) {
    return fail("Start date is after the agreement ends");
  }

  const recurring = parsed.data.kind === "recurring";
  const { error } = await supabase.rpc("update_agreement_schedule", {
    p_agreement_id: parsed.data.agreementId,
    p_kind: parsed.data.kind,
    p_start_date: parsed.data.startDate,
    ...(recurring
      ? {
          p_frequency: parsed.data.frequency,
          p_preferred_dow: parsed.data.preferredDow,
        }
      : {}),
  });
  if (error) return fail(error.message);
  return { ok: true };
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
}): Promise<ActionResult<{ routeId: string }>> {
  await requireOrg();
  const parsed = z
    .object({
      visitId: idSchema,
      crewId: idSchema,
      date: dateSchema,
    })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid visit assignment");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_visit", {
    p_visit_id: parsed.data.visitId,
    p_crew_id: parsed.data.crewId,
    p_service_date: parsed.data.date,
  });
  if (error || data == null) return fail(error?.message ?? "Could not assign visit");
  return { ok: true, data: { routeId: data } };
}

export async function rescheduleVisit(input: {
  visitId: string;
  crewId: string;
  date: string;
}): Promise<ActionResult<{ routeId: string }>> {
  await requireOrg();
  const parsed = z
    .object({
      visitId: idSchema,
      crewId: idSchema,
      date: dateSchema,
    })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid visit reschedule");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("office_reschedule_visit", {
    p_visit_id: parsed.data.visitId,
    p_crew_id: parsed.data.crewId,
    p_service_date: parsed.data.date,
  });
  if (error || data == null) return fail(error?.message ?? "Could not reschedule visit");
  return { ok: true, data: { routeId: data } };
}

export async function skipVisit(
  visitId: string,
  reason: "gate_locked" | "dog_loose" | "customer_skip" | "weather" | "equipment" | "unsafe" | "other",
): Promise<ActionResult> {
  await requireOrg();
  const parsed = z
    .object({
      visitId: idSchema,
      reason: z.enum(["gate_locked", "dog_loose", "customer_skip", "weather", "equipment", "unsafe", "other"]),
    })
    .safeParse({ visitId, reason });
  if (!parsed.success) return fail("Invalid skip");
  const supabase = await createClient();
  const { error } = await supabase.rpc("skip_visit", {
    p_visit_id: parsed.data.visitId,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error.message);
  return { ok: true };
}

export async function cancelVisit(visitId: string, reason: string): Promise<ActionResult> {
  await requireOrg();
  const parsed = z
    .object({
      visitId: idSchema,
      reason: z.string().trim().min(1).max(500),
    })
    .safeParse({ visitId, reason });
  if (!parsed.success) return fail("A cancel reason is required");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_visit", {
    p_visit_id: parsed.data.visitId,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(error.message);
  return { ok: true };
}

export async function approveSameDayExtra(
  enhancementId: string,
): Promise<ActionResult<{ enhancementId: string; approvedUntil: string }>> {
  await requireOrg();
  const parsed = idSchema.safeParse(enhancementId);
  if (!parsed.success) return fail("Invalid upsell");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("office_approve_same_day_extra", {
    p_enhancement_id: parsed.data,
  });
  if (error || data == null) return fail(error?.message ?? "Could not approve same-day extra");
  const body = z
    .object({
      id: idSchema,
      same_day_approved_until: z.string().min(1),
    })
    .safeParse(data);
  if (!body.success) return fail("Could not approve same-day extra");
  return {
    ok: true,
    data: { enhancementId: body.data.id, approvedUntil: body.data.same_day_approved_until },
  };
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

const rainDayResultSchema = z.object({
  service_date: dateSchema,
  target_date: dateSchema,
  pushed: z.array(idSchema),
  skipped: z.array(idSchema),
  untouched: z.array(idSchema),
});

export async function rainDayPush(input: {
  date: string;
  crewId?: string;
  visitIds?: string[];
}): Promise<
  ActionResult<{
    targetDate: string;
    pushed: number;
    skipped: number;
    untouched: number;
  }>
> {
  await requireOrg();
  const parsed = z
    .object({
      date: dateSchema,
      crewId: idSchema.optional(),
      visitIds: z.array(idSchema).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid rain day push");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("office_rain_day_push", {
    p_service_date: parsed.data.date,
    ...(parsed.data.crewId ? { p_crew_id: parsed.data.crewId } : {}),
    ...(parsed.data.visitIds ? { p_visit_ids: parsed.data.visitIds } : {}),
  });
  if (error || data == null) return fail(error?.message ?? "Could not push rain day");
  const body = rainDayResultSchema.safeParse(data);
  if (!body.success) return fail("Could not push rain day");
  return {
    ok: true,
    data: {
      targetDate: body.data.target_date,
      pushed: body.data.pushed.length,
      skipped: body.data.skipped.length,
      untouched: body.data.untouched.length,
    },
  };
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

export async function setCrewLead(crewId: string, profileId: string): Promise<ActionResult> {
  await requireOrg();
  const parsed = z.object({ crewId: idSchema, profileId: idSchema }).safeParse({ crewId, profileId });
  if (!parsed.success) return fail("Invalid crew lead");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_crew_lead", {
    p_crew_id: parsed.data.crewId,
    p_profile_id: parsed.data.profileId,
  });
  if (error) return fail(error.message);
  return { ok: true };
}
