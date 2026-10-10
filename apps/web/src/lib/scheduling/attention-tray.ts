export type AttentionBucket = "unassigned" | "overdue" | "needs_reschedule" | "flags";

export type AttentionVisit = {
  id: string;
  scheduled_date: string | null;
  status: string;
  title: string;
  account_name: string | null;
  address_line1: string | null;
  city: string | null;
  budget_minutes: number | null;
  reason: string | null;
  property_id: string | null;
  /** First new upsell on the visit; used for same-day approve. */
  enhancement_id: string | null;
  same_day_approved_until: string | null;
};

export type AttentionTray = {
  as_of: string;
  counts: Record<AttentionBucket, number>;
  unassigned: AttentionVisit[];
  overdue: AttentionVisit[];
  needs_reschedule: AttentionVisit[];
  flags: AttentionVisit[];
};

export const ATTENTION_BUCKETS: { key: AttentionBucket; label: string }[] = [
  { key: "unassigned", label: "Unassigned" },
  { key: "overdue", label: "Overdue" },
  { key: "needs_reschedule", label: "Needs reschedule" },
  { key: "flags", label: "Return visits and flags" },
];

/** Per-bucket rows shown before "Show all N". */
export const TRAY_BUCKET_LIMIT = 50;

export function trayCounts(tray: AttentionTray): Record<AttentionBucket, number> {
  return {
    unassigned: tray.counts?.unassigned ?? tray.unassigned.length,
    overdue: tray.counts?.overdue ?? tray.overdue.length,
    needs_reschedule: tray.counts?.needs_reschedule ?? tray.needs_reschedule.length,
    flags: tray.counts?.flags ?? tray.flags.length,
  };
}

export function trayTotal(counts: Record<AttentionBucket, number>): number {
  return counts.unassigned + counts.overdue + counts.needs_reschedule + counts.flags;
}

export function emptyAttentionTray(asOf: string): AttentionTray {
  return {
    as_of: asOf,
    counts: { unassigned: 0, overdue: 0, needs_reschedule: 0, flags: 0 },
    unassigned: [],
    overdue: [],
    needs_reschedule: [],
    flags: [],
  };
}

/** Card second line: "Okafor · 1503 Larkspur Ln". */
export function visitIdentityLine(visit: Pick<AttentionVisit, "account_name" | "address_line1">): string {
  const name = visit.account_name?.trim() || "Account";
  const street = visit.address_line1?.trim();
  return street ? `${name} · ${street}` : name;
}

export function warningCountBuckets(): AttentionBucket[] {
  return ["overdue", "flags"];
}

export function countBadgeClass(bucket: AttentionBucket, count: number): string {
  if (count > 0 && warningCountBuckets().includes(bucket)) {
    return "border-transparent bg-warning/15 text-warning";
  }
  return "";
}

export function visibleBucketVisits<T>(visits: T[], expanded: boolean, limit = TRAY_BUCKET_LIMIT): T[] {
  if (expanded || visits.length <= limit) return visits;
  return visits.slice(0, limit);
}

export function canSkipOrCancel(status: string): boolean {
  return status === "scheduled" || status === "in_progress" || status === "paused";
}

export function canAssign(status: string): boolean {
  return status === "scheduled";
}

export function canReschedule(status: string): boolean {
  return status === "skipped" || status === "cant_complete";
}

/** Same-day approve is offered for a new upsell that is not already active today. */
export function canApproveSameDay(visit: Pick<AttentionVisit, "enhancement_id" | "same_day_approved_until">): boolean {
  return !!visit.enhancement_id && !visit.same_day_approved_until;
}
