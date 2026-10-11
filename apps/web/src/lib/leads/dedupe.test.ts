import { describe, expect, it } from "vitest";
import {
  EXACT_PROPERTY_RADIUS_M,
  LEAD_FOLD_WINDOW_MS,
  distanceMeters,
  normalizeAddressKey,
  normalizeLeadEmail,
  normalizeLeadPhone,
  pickAutoLink,
  rankMatchCandidates,
  shouldFoldIntoOpenRequest,
  type MatchSourceAccount,
  type MatchSourceProperty,
} from "./dedupe";

describe("normalizeLeadPhone", () => {
  it("maps US 10-digit and +1 formats to the same E.164 value", () => {
    expect(normalizeLeadPhone("5125551212")).toBe("+15125551212");
    expect(normalizeLeadPhone("(512) 555-1212")).toBe("+15125551212");
    expect(normalizeLeadPhone("+1 512 555 1212")).toBe("+15125551212");
  });
});

describe("normalizeLeadEmail", () => {
  it("lower-cases and trims email", () => {
    expect(normalizeLeadEmail(" Ada@Example.COM ")).toBe("ada@example.com");
  });
});

describe("normalizeAddressKey", () => {
  it("collapses case and whitespace for exact property compare", () => {
    expect(normalizeAddressKey("123 Main St", "Austin", "tx", "78701")).toBe(
      "123 main st|austin|tx|78701",
    );
    expect(normalizeAddressKey("123  Main St", "Austin", "TX", "78701")).toBe(
      "123 main st|austin|tx|78701",
    );
  });
});

describe("rankMatchCandidates", () => {
  const accounts: MatchSourceAccount[] = [
    { id: "acct-1", name: "Jane Doe", phone: "+15125551212", email: "jane@example.com" },
    { id: "acct-2", name: "Nearby Neighbor", phone: null, email: null },
  ];

  const properties: MatchSourceProperty[] = [
    {
      id: "prop-1",
      accountId: "acct-1",
      accountName: "Jane Doe",
      addressKey: "123 main st|austin|tx|78701",
      lat: 30.27,
      lng: -97.74,
    },
    {
      id: "prop-2",
      accountId: "acct-2",
      accountName: "Nearby Neighbor",
      addressKey: "125 main st|austin|tx|78701",
      lat: 30.2705,
      lng: -97.7405,
    },
  ];

  it("ranks exact property above same account and possible", () => {
    const ranked = rankMatchCandidates(
      {
        phone: "+15125551212",
        email: null,
        addressKey: "123 main st|austin|tx|78701",
        lat: 30.27,
        lng: -97.74,
      },
      accounts,
      properties,
    );

    expect(ranked.map((c) => c.rank)).toEqual(["exact_property", "possible"]);
    expect(ranked[0]).toMatchObject({
      accountId: "acct-1",
      propertyId: "prop-1",
      rank: "exact_property",
    });
    expect(ranked[1]?.accountId).toBe("acct-2");
  });

  it("treats same phone different format as same_account when address differs", () => {
    const ranked = rankMatchCandidates(
      {
        phone: normalizeLeadPhone("(512) 555-1212"),
        email: null,
        addressKey: "999 other rd|austin|tx|78702",
        lat: null,
        lng: null,
      },
      accounts,
      properties,
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({
      accountId: "acct-1",
      rank: "same_account",
      reasons: expect.arrayContaining(["phone"]),
    });
  });

  it("marks near geocoded points as possible when not exact", () => {
    const nearM = distanceMeters(30.27, -97.74, 30.2705, -97.7405);
    expect(nearM).toBeGreaterThan(EXACT_PROPERTY_RADIUS_M);
    expect(nearM).toBeLessThan(800);

    const ranked = rankMatchCandidates(
      {
        phone: null,
        email: null,
        addressKey: null,
        lat: 30.27,
        lng: -97.74,
      },
      accounts,
      properties,
    );

    expect(ranked.some((c) => c.accountId === "acct-2" && c.rank === "possible")).toBe(true);
  });
});

describe("pickAutoLink", () => {
  it("auto-links only exact property and never merges other ranks", () => {
    expect(
      pickAutoLink([
        {
          accountId: "acct-1",
          accountName: "Jane",
          propertyId: "prop-1",
          rank: "exact_property",
          reasons: ["address"],
        },
      ]),
    ).toEqual({ accountId: "acct-1", propertyId: "prop-1" });

    expect(
      pickAutoLink([
        {
          accountId: "acct-1",
          accountName: "Jane",
          propertyId: null,
          rank: "same_account",
          reasons: ["phone"],
        },
      ]),
    ).toBeNull();
  });
});

describe("shouldFoldIntoOpenRequest", () => {
  it("folds when identity matches within the short window", () => {
    const now = 1_000_000;
    expect(
      shouldFoldIntoOpenRequest(
        { phone: "+15125551212", email: null },
        {
          phone: "+15125551212",
          email: "other@example.com",
          status: "new",
          createdAtMs: now - LEAD_FOLD_WINDOW_MS + 1_000,
        },
        now,
      ),
    ).toBe(true);
  });

  it("does not fold outside the window or on closed statuses", () => {
    const now = 1_000_000;
    expect(
      shouldFoldIntoOpenRequest(
        { phone: "+15125551212", email: null },
        {
          phone: "+15125551212",
          email: null,
          status: "new",
          createdAtMs: now - LEAD_FOLD_WINDOW_MS - 1,
        },
        now,
      ),
    ).toBe(false);
    expect(
      shouldFoldIntoOpenRequest(
        { phone: "+15125551212", email: null },
        {
          phone: "+15125551212",
          email: null,
          status: "won",
          createdAtMs: now - 1_000,
        },
        now,
      ),
    ).toBe(false);
  });
});
