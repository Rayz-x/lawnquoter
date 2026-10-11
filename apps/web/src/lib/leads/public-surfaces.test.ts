import { describe, expect, it } from "vitest";
import { ROUGH_ESTIMATE_LABEL } from "./rough-estimate";
import { leadAckEmail, leadPublicFormCopy, type LeadPublicFields } from "./public-surfaces";

const lead: LeadPublicFields = {
  contactName: "Pat Homeowner",
  services: ["mow"],
  typedAddress: "123 Oak St",
};

describe("lead public surfaces", () => {
  it("public form copy never includes a rough estimate price or label", () => {
    const copy = leadPublicFormCopy(lead);
    expect(copy).not.toMatch(/\$\d/);
    expect(copy.toLowerCase()).not.toContain("rough");
    expect(copy).not.toContain(ROUGH_ESTIMATE_LABEL);
    expect(copy).not.toContain("estimate");
  });

  it("acknowledgment email never includes a rough estimate price or label", () => {
    const email = leadAckEmail({ to: "pat@example.com", orgName: "Green Co", lead });
    const blob = `${email.subject}\n${email.text}\n${email.html}`;
    expect(blob).not.toMatch(/\$\d/);
    expect(blob.toLowerCase()).not.toContain("rough");
    expect(blob).not.toContain(ROUGH_ESTIMATE_LABEL);
    expect(blob.toLowerCase()).not.toContain("estimate");
  });
});
