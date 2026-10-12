export type SplitGroupInput = { title: string; lineIds: string[] };

export type SplitPlan =
  | { ok: true; groups: SplitGroupInput[] }
  | { ok: false; error: string };

export function planQuoteSplit(lines: { id: string; name: string }[], groups: SplitGroupInput[]): SplitPlan {
  const titled = groups
    .map((group) => ({ title: group.title.trim(), lineIds: [...new Set(group.lineIds)] }))
    .filter((group) => group.lineIds.length > 0);
  if (titled.length < 2) return { ok: false, error: "Put lines on at least two jobs." };
  if (titled.some((group) => group.title.length < 1)) return { ok: false, error: "Each job needs a title." };
  const known = new Set(lines.map((line) => line.id));
  const seen = new Set<string>();
  for (const group of titled) {
    for (const lineId of group.lineIds) {
      if (!known.has(lineId)) return { ok: false, error: "A line is not on this quote." };
      if (seen.has(lineId)) return { ok: false, error: "A line can only be on one job." };
      seen.add(lineId);
    }
  }
  return { ok: true, groups: titled };
}
