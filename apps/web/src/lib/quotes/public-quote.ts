import type { PublicOrg } from "@/lib/brand/public-org";

export type PublicQuoteItem = {
  id: string;
  name: string;
  description: string | null;
  state: "included" | "recommended" | "optional";
  option_group: string | null;
  option_tier: string;
  price: number;
  range_low: number | null;
  range_high: number | null;
  photo_url: string | null;
  selected: boolean;
};

export type PublicAcceptance = {
  document_hash: string;
  accepted_at: string;
  signer_name: string;
  signer_email: string | null;
  accepted_total: number | null;
  accepted_not_to_exceed: number | null;
  has_ranges: boolean;
  not_to_exceed_clause: string | null;
  disclosure_version: string | null;
  selections: string[] | null;
};

export type PublicQuote = {
  title: string;
  number: number;
  intro: string | null;
  notes_customer: string | null;
  expires_at: string | null;
  status: string;
  org: PublicOrg;
  items: PublicQuoteItem[];
  acceptance: PublicAcceptance | null;
};
