import { describe, expect, it } from "vitest";
import {
  findRepeatFoldLead,
  LEAD_REPEAT_FOLD_WINDOW_MS,
  pickExactPropertyLink,
  possibleMatchBannerText,
  rankMatchCandidates,
  type MatchCandidateInput,
  type MatchProbe,
} from "./dedupe";
import { normalizePhoneE164 } from "./normalize-contact";

const baseProbe: MatchProbe = {
  phone: "(512) 555-1212",
  email: "Jane@Example.COM",
  addressTyped: "123 Main St, Austin, TX 78701",
  addressLine1: "123 Main St",
  city: "Austin",
  postalCode: "78701",
  lat: 30.27,
  lng: -97.74,
};

function candidate(overrides: Partial<MatchCandidateInput> = {}): MatchCandidateInput {
  return {
    accountId: "acct-1",
    accountName: "Jane Doe",
    propertyId: "prop-1",
    addressLine1: "123 Main St",
    city: "Austin",
    postalCode: "78701",
    formattedAddress: "123 Main St, Austin, TX 78701",
    accountPhone: "+15125551212",
    accountEmail: "jane@example.com",
    distanceM: null,
    ...overrides,
  };
}

describe("normalizePhoneE164", () => {
  it("matches the same phone across formats", () => {
    expect(normalizePhoneE164("(512) 555-1212")).toBe("+15125551212");
    expect(normalizePhoneE164("512-555-1212")).toBe("+15125551212");
    expect(normalizePhoneE164("+1 512 555 1212")).toBe("+15125551212");
    expect(normalizePhoneE164("15125551212")).toBe("+15125551212");
  });
});

describe("rankMatchCandidates", () => {
  it("ranks exact property, same account, and possible", () => {
    const ranked = rankMatchCandidates(baseProbe, [
      candidate({
        accountId: "exact",
        accountName: "Exact Home",
        propertyId: "p-exact",
        distanceM: 10,
      }),
      candidate({
        accountId: "same",
        accountName: "Same Phone",
        propertyId: null,
        addressLine1: null,
        city: null,
        postalCode: null,
        formattedAddress: null,
        accountPhone: "5125551212",
        accountEmail: null,
        distanceM: null,
      }),
      candidate({
        accountId: "near",
        accountName: "Nearby Other",
        propertyId: "p-near",
        addressLine1: "125 Main St",
        formattedAddress: "125 Main St, Austin, TX 78701",
        accountPhone: "+15551234567",
        accountEmail: "other@example.com",
        distanceM: 50,
      }),
    ]);

    expect(ranked.map((row) => row.kind)).toEqual(["exact_property", "same_account", "possible"]);
    expect(pickExactPropertyLink(ranked)?.accountId).toBe("exact");
  });

  it("treats normalized address equality as exact property", () => {
    const ranked = rankMatchCandidates(
      { ...baseProbe, phone: null, email: null },
      [
        candidate({
          accountPhone: null,
          accountEmail: null,
          formattedAddress: "123 Main St, Austin, TX 78701",
          distanceM: null,
        }),
      ],
    );
    expect(ranked[0]?.kind).toBe("exact_property");
  });

  it("never invents a merge — only ranked candidates", () => {
    const ranked = rankMatchCandidates(baseProbe, [
      candidate({ accountId: "a", accountName: "A" }),
      candidate({ accountId: "b", accountName: "B", propertyId: "p-b", accountPhone: null, accountEmail: null, distanceM: 40 }),
    ]);
    expect(ranked.every((row) => row.accountId && row.kind)).toBe(true);
    expect(ranked.some((row) => (row as { merged?: boolean }).merged)).toBe(false);
  });
});

describe("findRepeatFoldLead", () => {
  it("folds a duplicate submit within the window into the open request", () => {
    const now = Date.parse("2026-10-11T12:00:00.000Z");
    const open = findRepeatFoldLead(
      { phone: "512-555-1212", email: null },
      [
        {
          id: "lead-open",
          phone: "+15125551212",
          email: null,
          status: "new",
          createdAtMs: now - 60_000,
        },
        {
          id: "lead-old",
          phone: "+15125551212",
          email: null,
          status: "new",
          createdAtMs: now - LEAD_REPEAT_FOLD_WINDOW_MS - 1,
        },
      ],
      { nowMs: now },
    );
    expect(open?.id).toBe("lead-open");
  });

  it("does not fold outside the window or into spam/lost", () => {
    const now = Date.parse("2026-10-11T12:00:00.000Z");
    expect(
      findRepeatFoldLead(
        { phone: "+15125551212", email: null },
        [{ id: "spam", phone: "+15125551212", email: null, status: "spam", createdAtMs: now - 1_000 }],
        { nowMs: now },
      ),
    ).toBeNull();
  });
});

describe("possibleMatchBannerText", () => {
  it("formats the office banner", () => {
    expect(possibleMatchBannerText("Acme Lawn")).toBe("Possible match: Acme Lawn");
  });
});
