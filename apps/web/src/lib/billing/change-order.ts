export type PublicChangeOrder = {
  id: string;
  status: "sent" | "accepted" | "declined";
  line_name: string;
  prior_cap_cents: number;
  proposed_amount_cents: number;
  new_cap_cents: number;
  reason: string | null;
  accepted_at: string | null;
  signer_name: string | null;
  account_name: string;
  org: {
    name: string;
    phone: string | null;
    email: string | null;
    brand_color: string | null;
  };
};

function asCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Narrow a `change_order_public` JSON payload; coerces cents that arrive as strings. */
export function isPublicChangeOrder(value: unknown): value is PublicChangeOrder {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  const prior = asCents(o.prior_cap_cents);
  const proposed = asCents(o.proposed_amount_cents);
  const next = asCents(o.new_cap_cents);
  if (prior == null || proposed == null || next == null) return false;
  if (
    typeof o.id !== "string" ||
    typeof o.status !== "string" ||
    typeof o.line_name !== "string" ||
    typeof o.account_name !== "string" ||
    !o.org ||
    typeof o.org !== "object" ||
    typeof (o.org as { name?: unknown }).name !== "string"
  ) {
    return false;
  }
  o.prior_cap_cents = prior;
  o.proposed_amount_cents = proposed;
  o.new_cap_cents = next;
  return true;
}
