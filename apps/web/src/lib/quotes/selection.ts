export type SelectableItem = {
  id: string;
  state: string;
  option_group: string | null;
  selected?: boolean;
  price?: number | string | null;
  hours?: number | string | null;
  cost?: number | string | null;
};

/** One choice per option group, plus every included (or pre-selected) standalone line. */
export function defaultSelectedIds(items: SelectableItem[]): string[] {
  const ids: string[] = [];
  const groups = new Map<string, SelectableItem[]>();
  for (const item of items) {
    if (item.option_group) {
      const list = groups.get(item.option_group) ?? [];
      list.push(item);
      groups.set(item.option_group, list);
    } else if (item.state === "included" || item.selected) {
      ids.push(item.id);
    }
  }
  for (const list of groups.values()) {
    const chosen = list.find((item) => item.selected) ?? list[0];
    if (chosen) ids.push(chosen.id);
  }
  return ids;
}

/** Honor an explicit choice, and fill any group the caller left blank. */
export function selectionFromIds(items: SelectableItem[], requested: string[] | null): string[] {
  if (!requested) return defaultSelectedIds(items);
  const known = new Set(items.map((item) => item.id));
  const picked = new Set(requested.filter((id) => known.has(id)));
  const groups = new Map<string, SelectableItem[]>();
  for (const item of items) {
    if (!item.option_group && item.state === "included") picked.add(item.id);
    if (item.option_group) {
      const list = groups.get(item.option_group) ?? [];
      list.push(item);
      groups.set(item.option_group, list);
    }
  }
  for (const list of groups.values()) {
    const chosen = list.filter((item) => picked.has(item.id));
    if (chosen.length === 1) continue;
    for (const item of list) picked.delete(item.id);
    const fallback = list.find((item) => item.selected) ?? list[0];
    if (fallback) picked.add(fallback.id);
  }
  return items.map((item) => item.id).filter((id) => picked.has(id));
}

export function sumSelected(items: SelectableItem[], ids: Iterable<string>, field: "price" | "hours" | "cost"): number {
  const picked = new Set(ids);
  return items.reduce((sum, item) => {
    if (!picked.has(item.id)) return sum;
    return sum + Number(item[field] ?? 0);
  }, 0);
}
