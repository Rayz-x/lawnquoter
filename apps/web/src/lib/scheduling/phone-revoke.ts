/** Visits the office should review after revoking a phone (started, not finished). */

export type RevokedUnsyncedVisit = {
  id: string;
  title: string;
  address: string | null;
  status: string;
  scheduledDate: string | null;
};

export function parseRevokePhoneResult(data: unknown): {
  profileId: string;
  revokedAt: string;
  unsynced: RevokedUnsyncedVisit[];
} | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (typeof row.profile_id !== "string" || typeof row.revoked_at !== "string") return null;
  const visits = Array.isArray(row.unsynced_visits) ? row.unsynced_visits : [];
  return {
    profileId: row.profile_id,
    revokedAt: row.revoked_at,
    unsynced: visits.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const visit = item as Record<string, unknown>;
      if (typeof visit.id !== "string" || typeof visit.title !== "string" || typeof visit.status !== "string") {
        return [];
      }
      return [
        {
          id: visit.id,
          title: visit.title,
          address: typeof visit.address === "string" ? visit.address : null,
          status: visit.status,
          scheduledDate: typeof visit.scheduled_date === "string" ? visit.scheduled_date : null,
        },
      ];
    }),
  };
}

/** Board copy when a phone was revoked and still has open started visits. */
export function unsyncedVisitLabel(count: number): string {
  if (count <= 0) return "No started visits waiting on this phone";
  if (count === 1) return "1 visit started but unsynced on this phone";
  return `${count} visits started but unsynced on this phone`;
}
