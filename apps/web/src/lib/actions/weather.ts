"use server";

import { z } from "zod";
import { fail, type ActionResult } from "@/lib/actions/result";
import { requireOrg } from "@/lib/auth/session";
import { isWeatherAction, isWeatherCondition } from "@/lib/scheduling/weather-rules";
import { createClient } from "@/lib/supabase/server";

const ruleSchema = z.object({
  condition: z.string(),
  threshold: z.number(),
  action: z.string(),
});

const applySchema = z.object({
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rainIn: z.number(),
  snowIn: z.number(),
  windMph: z.number(),
  tempF: z.number(),
});

export async function saveWeatherRule(input: z.infer<typeof ruleSchema>): Promise<ActionResult> {
  await requireOrg();
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success || !isWeatherCondition(parsed.data.condition) || !isWeatherAction(parsed.data.action)) {
    return fail("Pick rain, snow, wind, or freeze, and skip or push");
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_weather_skip_rule", {
    p_condition: parsed.data.condition,
    p_threshold: parsed.data.threshold,
    p_action: parsed.data.action,
  });
  if (error) return fail(error.message);
  return { ok: true };
}

export async function applyWeather(input: z.infer<typeof applySchema>): Promise<ActionResult<{ action: string | null; affected: number }>> {
  await requireOrg();
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return fail("Enter the weather for this day");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("office_apply_weather", {
    p_service_date: parsed.data.serviceDate,
    p_rain: parsed.data.rainIn,
    p_snow: parsed.data.snowIn,
    p_wind: parsed.data.windMph,
    p_temp: parsed.data.tempF,
  });
  if (error) return fail(error.message);
  const row = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const action = "action" in row && typeof row.action === "string" ? row.action : null;
  const affected = "affected" in row && typeof row.affected === "number" ? row.affected : 0;
  return { ok: true, data: { action, affected } };
}
