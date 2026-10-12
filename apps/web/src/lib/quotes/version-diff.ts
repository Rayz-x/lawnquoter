export type QuoteDiffSource = {
  section_id: string | null;
  name: string;
  qty: number | string;
  unit: string;
  price: number | string;
  state: string;
  sort: number;
};

export type QuoteDiffLine = {
  key: string;
  section: string;
  name: string;
  qty: number;
  unit: string;
  price: number;
  state: string;
};

export type QuoteVersionChange =
  | { kind: "added"; line: QuoteDiffLine }
  | { kind: "removed"; line: QuoteDiffLine }
  | { kind: "changed"; before: QuoteDiffLine; after: QuoteDiffLine };

function money(value: number | string): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

export function quoteDiffLines(input: {
  sections: { id: string; title: string }[];
  items: QuoteDiffSource[];
}): QuoteDiffLine[] {
  const titles = new Map(input.sections.map((section) => [section.id, section.title]));
  const seen = new Map<string, number>();
  return [...input.items]
    .sort((left, right) => left.sort - right.sort || left.name.localeCompare(right.name))
    .map((item) => {
      const section = (item.section_id && titles.get(item.section_id)) || "Work";
      const base = `${section}\0${item.name}`;
      const occurrence = seen.get(base) ?? 0;
      seen.set(base, occurrence + 1);
      return {
        key: `${base}\0${occurrence}`,
        section,
        name: item.name,
        qty: money(item.qty),
        unit: item.unit,
        price: money(item.price),
        state: item.state,
      };
    });
}

function sameLine(left: QuoteDiffLine, right: QuoteDiffLine): boolean {
  return left.qty === right.qty && left.unit === right.unit && left.price === right.price && left.state === right.state;
}

export function diffQuoteVersions(before: QuoteDiffLine[], after: QuoteDiffLine[]): QuoteVersionChange[] {
  const afterByKey = new Map(after.map((line) => [line.key, line]));
  const changes: QuoteVersionChange[] = [];
  const seen = new Set<string>();
  for (const line of before) {
    seen.add(line.key);
    const next = afterByKey.get(line.key);
    if (!next) changes.push({ kind: "removed", line });
    else if (!sameLine(line, next)) changes.push({ kind: "changed", before: line, after: next });
  }
  for (const line of after) {
    if (!seen.has(line.key)) changes.push({ kind: "added", line });
  }
  return changes;
}
