import { normalizeAddressKey, normalizePhoneE164 } from "@/lib/leads/normalize-contact";

export type DuplicateReason = "phone" | "address" | "phone_and_address";

export type AccountAddress = {
  addressLine1: string | null;
  city: string | null;
  postalCode: string | null;
};

export type AccountDirectoryEntry = {
  accountId: string;
  accountName: string;
  phones: Array<string | null>;
  addresses: AccountAddress[];
};

export type DuplicateProbe = {
  excludeAccountId?: string | null;
  phones: Array<string | null | undefined>;
  addresses: AccountAddress[];
};

export type AccountDuplicate = {
  accountId: string;
  accountName: string;
  reason: DuplicateReason;
  detail: string;
};

const STREET_SUFFIX: Record<string, string> = {
  street: "st",
  st: "st",
  avenue: "ave",
  ave: "ave",
  road: "rd",
  rd: "rd",
  drive: "dr",
  dr: "dr",
  boulevard: "blvd",
  blvd: "blvd",
  lane: "ln",
  ln: "ln",
  court: "ct",
  ct: "ct",
  place: "pl",
  pl: "pl",
  circle: "cir",
  cir: "cir",
  trail: "trl",
  trl: "trl",
  parkway: "pkwy",
  pkwy: "pkwy",
};

const REASON_RANK: Record<DuplicateReason, number> = {
  phone_and_address: 0,
  address: 1,
  phone: 2,
};

type AddressKey = { line: string | null; city: string | null; postal: string | null };

function phoneKey(raw: string | null | undefined): string | null {
  const normalized = normalizePhoneE164(raw);
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return normalized;
}

function streetKey(raw: string | null | undefined): string | null {
  const normalized = normalizeAddressKey(raw);
  if (!normalized) return null;
  const parts = normalized.split(" ");
  const last = parts[parts.length - 1] ?? "";
  const suffix = STREET_SUFFIX[last];
  if (suffix) parts[parts.length - 1] = suffix;
  return parts.join(" ");
}

function postalKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length >= 5) return digits.slice(0, 5);
  const text = normalizeAddressKey(raw);
  return text;
}

function addressKey(address: AccountAddress): AddressKey {
  return {
    line: streetKey(address.addressLine1),
    city: normalizeAddressKey(address.city),
    postal: postalKey(address.postalCode),
  };
}

function addressesMatch(left: AddressKey, right: AddressKey): boolean {
  if (!left.line || !right.line || left.line !== right.line) return false;
  if (left.postal && right.postal) return left.postal === right.postal;
  if (left.city && right.city) return left.city === right.city;
  return false;
}

function detailFor(reason: DuplicateReason, name: string): string {
  if (reason === "phone_and_address") return `Same phone and address as ${name}`;
  if (reason === "address") return `Same address as ${name}`;
  return `Same phone as ${name}`;
}

export function findAccountDuplicates(probe: DuplicateProbe, directory: AccountDirectoryEntry[]): AccountDuplicate[] {
  const phones = new Set(probe.phones.map(phoneKey).filter((phone): phone is string => phone != null));
  const addresses = probe.addresses.map(addressKey).filter((address) => address.line);
  if (!phones.size && !addresses.length) return [];

  const matches: AccountDuplicate[] = [];
  for (const entry of directory) {
    if (probe.excludeAccountId && entry.accountId === probe.excludeAccountId) continue;
    const phoneHit = entry.phones.some((phone) => {
      const key = phoneKey(phone);
      return key != null && phones.has(key);
    });
    const addressHit = entry.addresses.some((address) => {
      const key = addressKey(address);
      return addresses.some((probeAddress) => addressesMatch(probeAddress, key));
    });
    if (!phoneHit && !addressHit) continue;
    const reason: DuplicateReason = phoneHit && addressHit ? "phone_and_address" : addressHit ? "address" : "phone";
    matches.push({
      accountId: entry.accountId,
      accountName: entry.accountName,
      reason,
      detail: detailFor(reason, entry.accountName),
    });
  }

  return matches.sort((left, right) => {
    const rank = REASON_RANK[left.reason] - REASON_RANK[right.reason];
    if (rank !== 0) return rank;
    return left.accountName.localeCompare(right.accountName);
  });
}

type AccountRow = {
  id: string;
  name: string;
  phone: string | null;
  billing_address_line1: string | null;
  billing_city: string | null;
  billing_postal_code: string | null;
};

type ContactRow = { account_id: string; phone: string | null };

type PropertyRow = {
  account_id: string;
  address_line1: string | null;
  city: string | null;
  postal_code: string | null;
};

export function directoryFromRows(input: {
  accounts: AccountRow[];
  contacts: ContactRow[];
  properties: PropertyRow[];
}): AccountDirectoryEntry[] {
  const byId = new Map<string, AccountDirectoryEntry>();
  for (const account of input.accounts) {
    const addresses: AccountAddress[] = [];
    if (account.billing_address_line1) {
      addresses.push({
        addressLine1: account.billing_address_line1,
        city: account.billing_city,
        postalCode: account.billing_postal_code,
      });
    }
    byId.set(account.id, {
      accountId: account.id,
      accountName: account.name,
      phones: [account.phone],
      addresses,
    });
  }
  for (const contact of input.contacts) {
    const entry = byId.get(contact.account_id);
    if (!entry || !contact.phone) continue;
    entry.phones.push(contact.phone);
  }
  for (const property of input.properties) {
    const entry = byId.get(property.account_id);
    if (!entry) continue;
    entry.addresses.push({
      addressLine1: property.address_line1,
      city: property.city,
      postalCode: property.postal_code,
    });
  }
  return [...byId.values()];
}
