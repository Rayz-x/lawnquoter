const STALE_MS = 30 * 60 * 1000;

export function phoneSyncStatus(input: {
  packVersion: number | null;
  lastSyncedAt: string | null;
  now: Date;
  timeZone?: string;
  staleMs?: number;
}): { versionLabel: string | null; syncLabel: string } {
  const versionLabel = input.packVersion == null ? null : `Pack v${input.packVersion}`;
  if (input.lastSyncedAt == null) return { versionLabel, syncLabel: "No contact since" };
  const at = Date.parse(input.lastSyncedAt);
  if (!Number.isFinite(at)) return { versionLabel, syncLabel: "No contact since" };
  const label = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: input.timeZone ?? "UTC",
  }).format(new Date(at));
  const staleMs = input.staleMs ?? STALE_MS;
  if (input.now.getTime() - at > staleMs) {
    return { versionLabel, syncLabel: `No contact since ${label}` };
  }
  return { versionLabel, syncLabel: `Last synced ${label}` };
}
