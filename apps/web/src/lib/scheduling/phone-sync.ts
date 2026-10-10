import type { RevokedUnsyncedVisit } from "./phone-revoke";

const STALE_MS = 30 * 60 * 1000;

export type PhoneSyncStatus = {
  /** "Route v3 · Ana has v2" on mismatch; "Route v3" when in sync; null when no route version. */
  versionLabel: string | null;
  syncLabel: string;
  /** Stale, never synced, or phone pack behind the published route. */
  attention: boolean;
};

export type BoardPhone = {
  profileId: string;
  name: string;
  packVersion: number | null;
  lastSyncedAt: string | null;
  revokedAt: string | null;
  unsynced: RevokedUnsyncedVisit[];
};

/** One board row per crew member; sync fields stay null until they ack a pack. */
export function boardPhonesForCrew(input: {
  members: { profileId: string; name: string }[];
  syncByProfile: Map<string, { packVersion: number; lastSyncedAt: string }>;
  revokeByProfile?: Map<string, { revokedAt: string; unsynced: RevokedUnsyncedVisit[] }>;
}): BoardPhone[] {
  return input.members.map((member) => {
    const sync = input.syncByProfile.get(member.profileId);
    const revoke = input.revokeByProfile?.get(member.profileId);
    return {
      profileId: member.profileId,
      name: member.name,
      packVersion: sync?.packVersion ?? null,
      lastSyncedAt: sync?.lastSyncedAt ?? null,
      revokedAt: revoke?.revokedAt ?? null,
      unsynced: revoke?.unsynced ?? [],
    };
  });
}

export function phoneSyncStatus(input: {
  phoneName: string;
  packVersion: number | null;
  routeVersion: number | null;
  lastSyncedAt: string | null;
  now: Date;
  timeZone?: string;
  staleMs?: number;
}): PhoneSyncStatus {
  const mismatch =
    input.routeVersion != null &&
    input.packVersion != null &&
    input.packVersion < input.routeVersion;
  const versionLabel =
    input.routeVersion == null
      ? null
      : mismatch
        ? `Route v${input.routeVersion} · ${input.phoneName} has v${input.packVersion}`
        : `Route v${input.routeVersion}`;

  if (input.lastSyncedAt == null) {
    return { versionLabel, syncLabel: "Never synced", attention: true };
  }
  const at = Date.parse(input.lastSyncedAt);
  if (!Number.isFinite(at)) {
    return { versionLabel, syncLabel: "Never synced", attention: true };
  }
  const label = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: input.timeZone ?? "UTC",
  }).format(new Date(at));
  const staleMs = input.staleMs ?? STALE_MS;
  if (input.now.getTime() - at > staleMs) {
    return {
      versionLabel,
      syncLabel: `No contact since ${label}`,
      attention: true,
    };
  }
  return {
    versionLabel,
    syncLabel: `Last synced ${label}`,
    attention: mismatch,
  };
}
