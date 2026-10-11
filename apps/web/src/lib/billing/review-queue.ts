export type BillingHoldReason =
  | "partly_done"
  | "completed_after_cancel"
  | "photo_lost"
  | "upsell_review";

export type BillingReviewTask = {
  id: string;
  label: string;
  amount_cents: number;
  done: boolean;
};

export type BillingReviewUpsell = {
  id: string;
  tag: string;
  note: string | null;
  status: string;
};

export type BillingReviewVisit = {
  id: string;
  property_id: string | null;
  account_id: string | null;
  account_name: string | null;
  address_line1: string | null;
  city: string | null;
  title: string;
  status: string;
  service_date: string | null;
  hold_reason: BillingHoldReason | string;
  completed_after_cancel: boolean;
  tasks: BillingReviewTask[];
  upsells: BillingReviewUpsell[];
};

export type BillingReviewQueue = {
  count: number;
  items: BillingReviewVisit[];
};

export type BillingResolution = "full" | "partial" | "zero";

const HOLD_LABELS: Record<string, string> = {
  partly_done: "Partly done",
  completed_after_cancel: "Completed after cancel",
  photo_lost: "Photo lost",
  upsell_review: "Upsell review",
};

export function holdReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Held";
  return HOLD_LABELS[reason] ?? reason.replaceAll("_", " ");
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function emptyBillingReviewQueue(): BillingReviewQueue {
  return { count: 0, items: [] };
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function parseTask(item: unknown): BillingReviewTask | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.label !== "string") return null;
  return {
    id: row.id,
    label: row.label,
    amount_cents: asNumber(row.amount_cents) ?? 0,
    done: asBoolean(row.done),
  };
}

function parseUpsell(item: unknown): BillingReviewUpsell | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.tag !== "string" || typeof row.status !== "string") {
    return null;
  }
  return {
    id: row.id,
    tag: row.tag,
    note: asString(row.note),
    status: row.status,
  };
}

export function parseBillingReviewVisit(item: unknown): BillingReviewVisit | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.status !== "string") {
    return null;
  }
  if (typeof row.hold_reason !== "string") return null;
  const tasks = Array.isArray(row.tasks)
    ? row.tasks.flatMap((task) => {
        const parsed = parseTask(task);
        return parsed ? [parsed] : [];
      })
    : [];
  const upsells = Array.isArray(row.upsells)
    ? row.upsells.flatMap((upsell) => {
        const parsed = parseUpsell(upsell);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    id: row.id,
    property_id: asString(row.property_id),
    account_id: asString(row.account_id),
    account_name: asString(row.account_name),
    address_line1: asString(row.address_line1),
    city: asString(row.city),
    title: row.title,
    status: row.status,
    service_date: asString(row.service_date),
    hold_reason: row.hold_reason,
    completed_after_cancel: asBoolean(row.completed_after_cancel),
    tasks,
    upsells,
  };
}

export function parseBillingReviewQueue(value: unknown): BillingReviewQueue {
  if (!value || typeof value !== "object") return emptyBillingReviewQueue();
  const body = value as Record<string, unknown>;
  const items = Array.isArray(body.items)
    ? body.items.flatMap((item) => {
        const visit = parseBillingReviewVisit(item);
        return visit ? [visit] : [];
      })
    : [];
  const count = typeof body.count === "number" && Number.isFinite(body.count) ? body.count : items.length;
  return { count, items };
}

export function visitIdentityLine(
  visit: Pick<BillingReviewVisit, "account_name" | "address_line1">,
): string {
  const name = visit.account_name?.trim() || "Account";
  const street = visit.address_line1?.trim();
  return street ? `${name} · ${street}` : name;
}
