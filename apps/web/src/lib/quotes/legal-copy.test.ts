import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ESIGN_DISCLOSURE_VERSION,
  ESIGN_DISCLOSURES,
  NOT_TO_EXCEED_CLAUSE,
  notToExceedClause,
} from "./legal-copy";

const migration = readFileSync(
  path.resolve(process.cwd(), "../../supabase/migrations/20261009180000_acceptance_not_to_exceed.sql"),
  "utf8",
);

describe("not-to-exceed clause", () => {
  it("fills the amount into the single lawyer-editable sentence", () => {
    expect(notToExceedClause("$210.00")).toBe(
      "You agree to pay no more than $210.00; the final invoice may be lower.",
    );
    expect(NOT_TO_EXCEED_CLAUSE).toContain("{amount}");
    expect(migration).toContain(NOT_TO_EXCEED_CLAUSE);
  });
});

describe("ESIGN disclosures", () => {
  it("covers the consumer consent topics in one file", () => {
    const ids = ESIGN_DISCLOSURES.map((section) => section.id);
    expect(ids).toEqual([
      "electronic-business",
      "paper-copy",
      "withdraw-consent",
      "hardware-software",
      "update-contact",
    ]);
    for (const section of ESIGN_DISCLOSURES) {
      expect(section.heading.trim().length).toBeGreaterThan(0);
      expect(section.body.trim().length).toBeGreaterThan(40);
    }
    expect(migration).toContain(ESIGN_DISCLOSURE_VERSION);
  });

  it("is pinned so a text edit must bump the disclosure version", () => {
    const hash = createHash("sha256").update(JSON.stringify(ESIGN_DISCLOSURES)).digest("hex");
    expect({ version: ESIGN_DISCLOSURE_VERSION, hash }).toEqual({
      version: "2026-10-09-draft",
      hash: "8ab53f515b34614cb4d02417c89340f05cd03831ab3344b6c15b0b07bd9ff94e",
    });
  });
});
