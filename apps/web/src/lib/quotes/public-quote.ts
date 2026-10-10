import type { PublicOrg } from "@/lib/brand/public-org";

export type PublicQuoteSection = {
  id: string;
  title: string;
  sort?: number;
};

export type PublicQuoteItem = {
  id: string;
  section_id?: string | null;
  name: string;
  description: string | null;
  state: "included" | "recommended" | "optional";
  option_group: string | null;
  option_tier: string;
  price: number;
  range_low: number | null;
  range_high: number | null;
  site_check_reasons?: string[] | null;
  verified_price?: number | null;
  verified_at?: string | null;
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

export type PublicSiteCheck = {
  id: string;
  status: string;
  origin: string;
  window_start: string | null;
  window_end: string | null;
  decline_reason: string | null;
  requested_at: string | null;
  method: string | null;
};

export type PublicQuote = {
  title: string;
  number: number;
  intro: string | null;
  notes_customer: string | null;
  expires_at: string | null;
  status: string;
  site_check_status?: string | null;
  site_check?: PublicSiteCheck | null;
  site_check_can_request?: boolean | null;
  site_check_account_cap_reached?: boolean | null;
  org: PublicOrg;
  sections?: PublicQuoteSection[];
  items: PublicQuoteItem[];
  acceptance: PublicAcceptance | null;
};
