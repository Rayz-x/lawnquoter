export type AttentionBucket = "unassigned" | "overdue" | "needs_reschedule" | "flags";

export type AttentionVisit = {
  id: string;
  scheduled_date: string | null;
  status: string;
  title: string;
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

export function trayCounts(tray: AttentionTray): Record<AttentionBucket, number> {
  return {
    unassigned: tray.unassigned.length,
    overdue: tray.overdue.length,
    needs_reschedule: tray.needs_reschedule.length,
    flags: tray.flags.length,
  };
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
