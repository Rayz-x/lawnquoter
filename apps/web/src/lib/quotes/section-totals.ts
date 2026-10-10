import { sumSelected, type SelectableItem } from "./selection";

export type QuoteSection = {
  id: string;
  title: string;
};

export type SectionMoney = {
  price: number;
  hours: number;
  cost: number;
};

export type SectionTotal = QuoteSection & SectionMoney;

export type QuoteSectionTotals = {
  sections: SectionTotal[];
  addOns: SectionMoney;
  total: SectionMoney;
};

type SectionItem = SelectableItem & {
  section_id?: string | null;
};

function money(items: SectionItem[], ids: Iterable<string>): SectionMoney {
  return {
    price: sumSelected(items, ids, "price"),
    hours: sumSelected(items, ids, "hours"),
    cost: sumSelected(items, ids, "cost"),
  };
}

function addMoney(a: SectionMoney, b: SectionMoney): SectionMoney {
  return {
    price: a.price + b.price,
    hours: a.hours + b.hours,
    cost: a.cost + b.cost,
  };
}

/**
 * Section subtotals from the selected lines. Option groups stay pick-one via
 * the caller’s selected ids; a group may live inside a section. Section prices
 * plus add-ons always equal the grand total.
 */
export function quoteSectionTotals(
  items: SectionItem[],
  sections: QuoteSection[],
  selectedIds: Iterable<string>,
): QuoteSectionTotals {
  const picked = new Set(selectedIds);
  const known = new Set(sections.map((section) => section.id));
  const sectionRows = sections.map((section) => {
    const ids = items
      .filter((item) => item.section_id === section.id && picked.has(item.id))
      .map((item) => item.id);
    return { ...section, ...money(items, ids) };
  });
  const addOnIds = items
    .filter((item) => (!item.section_id || !known.has(item.section_id)) && picked.has(item.id))
    .map((item) => item.id);
  const addOns = money(items, addOnIds);
  const total = sectionRows.reduce((sum, section) => addMoney(sum, section), addOns);
  return { sections: sectionRows, addOns, total };
}
