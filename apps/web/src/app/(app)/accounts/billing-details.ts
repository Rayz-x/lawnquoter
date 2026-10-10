export const BILLING_DETAILS_LABEL = "+ Billing details";

export type BillingAddressFields = {
  billing_address_line1: string | null;
  billing_address_line2: string | null;
  billing_city: string | null;
  billing_region: string | null;
  billing_postal_code: string | null;
};

export type PropertyAddress = {
  address_line1: string;
  address_line2?: string | null;
  city: string;
  region: string;
  postal_code: string;
};

export type BillingAddressDraft = {
  billing_address_line1: string;
  billing_address_line2: string;
  billing_city: string;
  billing_region: string;
  billing_postal_code: string;
};

/** Billing email stays blank unless staff typed one. Never copies account email. */
export function billingEmailDraft(stored: string | null | undefined, accountEmail?: string | null): string {
  void accountEmail;
  return stored?.trim() ?? "";
}

/** Prefer saved billing address; otherwise default to the first property. */
export function billingAddressDraft(
  stored: BillingAddressFields,
  firstProperty: PropertyAddress | null | undefined,
): BillingAddressDraft {
  if (stored.billing_address_line1?.trim()) {
    return {
      billing_address_line1: stored.billing_address_line1,
      billing_address_line2: stored.billing_address_line2 ?? "",
      billing_city: stored.billing_city ?? "",
      billing_region: stored.billing_region ?? "",
      billing_postal_code: stored.billing_postal_code ?? "",
    };
  }
  if (firstProperty?.address_line1?.trim()) {
    return {
      billing_address_line1: firstProperty.address_line1,
      billing_address_line2: firstProperty.address_line2 ?? "",
      billing_city: firstProperty.city,
      billing_region: firstProperty.region,
      billing_postal_code: firstProperty.postal_code,
    };
  }
  return {
    billing_address_line1: "",
    billing_address_line2: "",
    billing_city: "",
    billing_region: "",
    billing_postal_code: "",
  };
}

export function shouldOpenBillingDetails(account: {
  type: string;
  company_name: string | null;
  billing_email: string | null;
  billing_address_line1?: string | null;
  net_terms_days: number;
  po_required: boolean;
  tax_exempt: boolean;
  consolidated_invoicing: boolean;
  parent_account_id: string | null;
}): boolean {
  return (
    account.type === "commercial" ||
    Boolean(
      account.company_name ||
        account.billing_email ||
        account.billing_address_line1 ||
        account.net_terms_days ||
        account.po_required ||
        account.tax_exempt ||
        account.consolidated_invoicing ||
        account.parent_account_id,
    )
  );
}
