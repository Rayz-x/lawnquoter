export const QUOTE_TEMPLATE_KINDS = ["mowing", "fert", "cleanup", "snow", "irrigation", "install", "other"] as const;
export type QuoteTemplateKind = (typeof QUOTE_TEMPLATE_KINDS)[number];

export type TemplateLine = {
  section: string;
  name: string;
  description: string | null;
  state: "included" | "recommended" | "optional";
  qty: number;
  unit: string;
  price: number;
};

export type QuoteTemplateConfig = { lines: TemplateLine[] };

const STATES = new Set(["included", "recommended", "optional"]);

function money(value: unknown): number | null {
  const amount = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(amount) ? amount : null;
}

export function quoteTemplateConfig(input: {
  sections: { id: string; title: string }[];
  items: {
    section_id: string | null;
    name: string;
    description: string | null;
    state: string;
    qty: number | string;
    unit: string;
    price: number | string;
    sort: number;
  }[];
}): QuoteTemplateConfig {
  const titles = new Map(input.sections.map((section) => [section.id, section.title]));
  const lines = [...input.items]
    .sort((left, right) => left.sort - right.sort)
    .flatMap((item) => {
      const price = money(item.price);
      const qty = money(item.qty);
      if (!item.name.trim() || price == null || qty == null || !STATES.has(item.state)) return [];
      return [{
        section: (item.section_id && titles.get(item.section_id)) || "Work",
        name: item.name.trim(),
        description: item.description,
        state: item.state as TemplateLine["state"],
        qty,
        unit: item.unit || "each",
        price,
      }];
    });
  return { lines };
}

export function readQuoteTemplateConfig(value: unknown): QuoteTemplateConfig | null {
  if (!value || typeof value !== "object" || !("lines" in value) || !Array.isArray(value.lines)) return null;
  const lines: TemplateLine[] = [];
  for (const raw of value.lines) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const section = typeof row.section === "string" && row.section.trim() ? row.section.trim() : "Work";
    const state = typeof row.state === "string" && STATES.has(row.state) ? row.state : null;
    const qty = money(row.qty);
    const price = money(row.price);
    const unit = typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : "each";
    const description = typeof row.description === "string" ? row.description : null;
    if (!name || !state || qty == null || price == null) return null;
    lines.push({ section, name, description, state: state as TemplateLine["state"], qty, unit, price });
  }
  return lines.length ? { lines } : null;
}

export function isQuoteTemplateKind(value: string): value is QuoteTemplateKind {
  return (QUOTE_TEMPLATE_KINDS as readonly string[]).includes(value);
}
