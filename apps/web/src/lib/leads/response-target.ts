import type { Json } from "@/lib/supabase/database.types";
import { DEFAULT_RESPONSE_TARGET_MINUTES } from "./age-badge";

/** Read org lead response target (minutes) from settings; default 60 (1 business hour). */
export function responseTargetMinutes(settings: Json | null | undefined): number {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return DEFAULT_RESPONSE_TARGET_MINUTES;
  }
  const raw = (settings as Record<string, Json | undefined>).lead_response_target_minutes;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string" && /^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (n > 0) return n;
  }
  return DEFAULT_RESPONSE_TARGET_MINUTES;
}
