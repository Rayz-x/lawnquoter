import type { createClient } from "@/lib/supabase/server";
import { recordingUrlFromMeta, timelineEntries, type TimelineEntry } from "./timeline";

type Client = Awaited<ReturnType<typeof createClient>>;

export async function loadContactTimeline(
  supabase: Client,
  scope: { accountId?: string | null; quoteId?: string | null; leadId?: string | null; contactOnly?: boolean },
): Promise<TimelineEntry[]> {
  const accountId = scope.accountId ?? null;
  const parts = [
    accountId ? `account_id.eq.${accountId}` : "",
    scope.quoteId ? `quote_id.eq.${scope.quoteId}` : "",
    scope.leadId ? `lead_request_id.eq.${scope.leadId}` : "",
  ].filter(Boolean);
  const [activities, messages, calls] = await Promise.all([
    accountId
      ? supabase.from("activities").select("id, kind, summary, occurred_at, meta").eq("account_id", accountId).order("occurred_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] }),
    parts.length
      ? supabase.from("messages").select("id, channel, direction, body, occurred_at, activity_id").or(parts.join(",")).order("occurred_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] }),
    accountId
      ? supabase.from("calls").select("id, direction, from_address, occurred_at, recording_url, activity_id").eq("account_id", accountId).order("occurred_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] }),
  ]);
  const activityRows = (activities.data ?? []).filter((row) => {
    if (!scope.contactOnly) return true;
    return row.kind.startsWith("email") || row.kind.startsWith("sms") || row.kind.startsWith("call");
  });
  return timelineEntries({
    activities: activityRows.map((row) => ({
      id: row.id,
      kind: row.kind,
      summary: row.summary,
      occurredAt: row.occurred_at,
      recordingUrl: recordingUrlFromMeta(row.meta),
    })),
    messages: (messages.data ?? []).map((row) => ({
      id: row.id,
      channel: row.channel,
      direction: row.direction,
      body: row.body,
      occurredAt: row.occurred_at,
      activityId: row.activity_id,
    })),
    calls: (calls.data ?? []).map((row) => ({
      id: row.id,
      direction: row.direction,
      from: row.from_address,
      occurredAt: row.occurred_at,
      recordingUrl: row.recording_url,
      activityId: row.activity_id,
    })),
  });
}
