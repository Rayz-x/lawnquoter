export type TimelineActivity = {
  id: string;
  kind: string;
  summary: string;
  occurredAt: string;
  recordingUrl?: string | null;
};

export type TimelineMessage = {
  id: string;
  channel: string;
  direction: string;
  body: string;
  occurredAt: string;
  activityId: string | null;
};

export type TimelineCall = {
  id: string;
  direction: string;
  from: string;
  occurredAt: string;
  recordingUrl: string | null;
  activityId: string | null;
};

export type TimelineEntry = {
  id: string;
  at: string;
  label: string;
  summary: string;
  recordingUrl: string | null;
};

export function timelineLabel(kind: string): string {
  if (kind.startsWith("email") || kind === "email") return "Email";
  if (kind.startsWith("sms") || kind === "text") return "Text";
  if (kind.startsWith("call")) return "Call";
  if (kind.startsWith("visit")) return "Visit";
  return kind.replaceAll("_", " ").replaceAll(".", " ");
}

export function recordingUrlFromMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as { recording_url?: unknown }).recording_url;
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : null;
}

export function timelineEntries(input: {
  activities: TimelineActivity[];
  messages: TimelineMessage[];
  calls: TimelineCall[];
}): TimelineEntry[] {
  const covered = new Set<string>();
  for (const message of input.messages) if (message.activityId) covered.add(message.activityId);
  for (const call of input.calls) if (call.activityId) covered.add(call.activityId);
  const entries: TimelineEntry[] = [];
  for (const activity of input.activities) {
    if (covered.has(activity.id)) continue;
    entries.push({
      id: `activity:${activity.id}`,
      at: activity.occurredAt,
      label: timelineLabel(activity.kind),
      summary: activity.summary,
      recordingUrl: activity.recordingUrl ?? null,
    });
  }
  for (const message of input.messages) {
    entries.push({
      id: `message:${message.id}`,
      at: message.occurredAt,
      label: message.channel === "email" ? "Email" : "Text",
      summary: message.body.trim() || (message.direction === "in" ? "Incoming message" : "Outgoing message"),
      recordingUrl: null,
    });
  }
  for (const call of input.calls) {
    entries.push({
      id: `call:${call.id}`,
      at: call.occurredAt,
      label: "Call",
      summary: call.direction === "out" ? `Call to ${call.from}` : `Call from ${call.from}`,
      recordingUrl: call.recordingUrl,
    });
  }
  return entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? -1 : 1));
}
