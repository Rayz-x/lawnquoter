import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountDuplicateNotice } from "@/components/accounts/duplicate-notice";
import {
  directoryFromRows,
  findAccountDuplicates,
  type AccountDirectoryEntry,
} from "./duplicates";

const maple: AccountDirectoryEntry = {
  accountId: "acct-maple",
  accountName: "Maple HOA",
  phones: ["+16155550142", null],
  addresses: [
    { addressLine1: "100 Maple Street", city: "Springfield", postalCode: "62704" },
    { addressLine1: "100 Maple St Apt 2", city: "Springfield", postalCode: "62704" },
  ],
};

describe("findAccountDuplicates", () => {
  it("matches a phone written with punctuation to the stored number", () => {
    const matches = findAccountDuplicates(
      { phones: ["(615) 555-0142"], addresses: [] },
      [maple],
    );
    expect(matches).toEqual([
      {
        accountId: "acct-maple",
        accountName: "Maple HOA",
        reason: "phone",
        detail: "Same phone as Maple HOA",
      },
    ]);
  });

  it("matches a contact phone stored on the account", () => {
    const directory = directoryFromRows({
      accounts: [{ id: "acct-maple", name: "Maple HOA", phone: null, billing_address_line1: null, billing_city: null, billing_postal_code: null }],
      contacts: [{ account_id: "acct-maple", phone: "615-555-0199" }],
      properties: [],
    });
    const matches = findAccountDuplicates({ phones: ["6155550199"], addresses: [] }, directory);
    expect(matches.map((match) => match.reason)).toEqual(["phone"]);
    expect(matches[0]?.accountName).toBe("Maple HOA");
  });

  it("matches a street abbreviation and a ZIP+4 to the same site", () => {
    const matches = findAccountDuplicates(
      {
        phones: [],
        addresses: [{ addressLine1: "100 Maple St", city: "Springfield", postalCode: "62704-1234" }],
      },
      [maple],
    );
    expect(matches).toEqual([
      {
        accountId: "acct-maple",
        accountName: "Maple HOA",
        reason: "address",
        detail: "Same address as Maple HOA",
      },
    ]);
  });

  it("does not treat a different ZIP or a different unit as the same address", () => {
    expect(
      findAccountDuplicates(
        { phones: [], addresses: [{ addressLine1: "100 Maple St", city: "Springfield", postalCode: "62701" }] },
        [maple],
      ),
    ).toEqual([]);
    expect(
      findAccountDuplicates(
        { phones: [], addresses: [{ addressLine1: "100 Maple St Apt 4", city: "Springfield", postalCode: "62704" }] },
        [maple],
      ),
    ).toEqual([]);
  });

  it("skips the account being edited and ignores a blank probe", () => {
    expect(
      findAccountDuplicates({ excludeAccountId: "acct-maple", phones: ["6155550142"], addresses: [] }, [maple]),
    ).toEqual([]);
    expect(
      findAccountDuplicates(
        { phones: ["555", ""], addresses: [{ addressLine1: "  ", city: null, postalCode: null }] },
        [maple],
      ),
    ).toEqual([]);
  });

  it("collapses a phone hit and an address hit into one row", () => {
    const matches = findAccountDuplicates(
      {
        phones: ["6155550142"],
        addresses: [{ addressLine1: "100 Maple Street", city: "Springfield", postalCode: "62704" }],
      },
      [maple],
    );
    expect(matches).toEqual([
      {
        accountId: "acct-maple",
        accountName: "Maple HOA",
        reason: "phone_and_address",
        detail: "Same phone and address as Maple HOA",
      },
    ]);
  });

  it("puts billing address and property address on the directory entry", () => {
    const directory = directoryFromRows({
      accounts: [
        {
          id: "acct-1",
          name: "Ada",
          phone: "6155550100",
          billing_address_line1: "9 Oak Ave",
          billing_city: "Nashville",
          billing_postal_code: "37206",
        },
      ],
      contacts: [],
      properties: [
        {
          account_id: "acct-1",
          address_line1: "12 Pine Rd",
          city: "Nashville",
          postal_code: "37206",
        },
      ],
    });
    expect(directory[0]?.phones).toEqual(["6155550100"]);
    expect(directory[0]?.addresses).toEqual([
      { addressLine1: "9 Oak Ave", city: "Nashville", postalCode: "37206" },
      { addressLine1: "12 Pine Rd", city: "Nashville", postalCode: "37206" },
    ]);
  });
});

describe("AccountDuplicateNotice", () => {
  it("links each match and stays quiet when there are none", () => {
    const markup = renderToStaticMarkup(
      createElement(AccountDuplicateNotice, {
        matches: [
          {
            accountId: "acct-maple",
            accountName: "Maple HOA",
            reason: "address",
            detail: "Same address as Maple HOA",
          },
        ],
      }),
    );
    expect(markup).toContain('data-testid="account-duplicate-notice"');
    expect(markup).toContain('href="/accounts/acct-maple"');
    expect(markup).toContain("Same address as Maple HOA");
    expect(renderToStaticMarkup(createElement(AccountDuplicateNotice, { matches: [] }))).toBe("");
  });
});
