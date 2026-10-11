import type { PublicOrg } from "@/lib/brand/public-org";

export type PublicInvoiceLine = {
  id: string;
  description: string;
  quantity: number;
  unit_price_cents: number;
  amount_cents: number;
  tax_cents: number;
  estimate_low_cents: number | null;
  estimate_high_cents: number | null;
  sort: number;
};

export type PublicInvoice = {
  id: string;
  number: number | null;
  number_label: string | null;
  status: string;
  currency: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  tax_label: string | null;
  issued_at: string | null;
  due_on: string | null;
  notes: string | null;
  po_number: string | null;
  account_name: string;
  org: PublicOrg;
  lines: PublicInvoiceLine[];
};
