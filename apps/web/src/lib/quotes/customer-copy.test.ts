import { describe, expect, it } from "vitest";
import { customerCopyUpdateError } from "./customer-copy";

const current = {
  title: "Spring cleanup",
  intro: "Hello",
  notes_customer: "Gate code 1234",
};

describe("customerCopyUpdateError", () => {
  it("returns an error when a frozen quote's title, intro, or customer notes change", () => {
    expect(customerCopyUpdateError(false, current, { title: "New title" })).toBe(
      "This proposal is frozen. Revise it before editing the title, intro, or customer notes.",
    );
    expect(customerCopyUpdateError(false, current, { intro: "Different intro" })).toMatch(/frozen/);
    expect(customerCopyUpdateError(false, current, { notes_customer: "New note" })).toMatch(/frozen/);
  });

  it("allows a save that does not change locked customer copy", () => {
    expect(customerCopyUpdateError(false, current, {})).toBeNull();
    expect(
      customerCopyUpdateError(false, current, {
        title: "  Spring cleanup  ",
        intro: "Hello",
        notes_customer: "Gate code 1234",
      }),
    ).toBeNull();
    expect(
      customerCopyUpdateError(
        false,
        { title: "Spring cleanup", intro: null, notes_customer: null },
        { intro: "", notes_customer: "   " },
      ),
    ).toBeNull();
  });

  it("allows customer-copy edits while the quote is editable", () => {
    expect(customerCopyUpdateError(true, current, { title: "New title", intro: "", notes_customer: "" })).toBeNull();
  });
});
