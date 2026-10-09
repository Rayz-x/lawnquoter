import { describe, expect, it } from "vitest";
import { ACCEPTED_QUOTE_DELETE_ERROR, deleteQuoteError } from "./delete-quote";

describe("deleteQuoteError", () => {
  it("returns a clear error for an accepted quote", () => {
    expect(deleteQuoteError("accepted")).toBe("Accepted quotes cannot be deleted.");
    expect(deleteQuoteError("accepted")).toBe(ACCEPTED_QUOTE_DELETE_ERROR);
  });

  it("allows deleting a quote that was never accepted", () => {
    expect(deleteQuoteError("draft")).toBeNull();
    expect(deleteQuoteError("sent")).toBeNull();
    expect(deleteQuoteError("viewed")).toBeNull();
    expect(deleteQuoteError("declined")).toBeNull();
    expect(deleteQuoteError("expired")).toBeNull();
    expect(deleteQuoteError("changed")).toBeNull();
  });
});
