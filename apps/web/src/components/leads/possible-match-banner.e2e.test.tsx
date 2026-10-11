import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PossibleMatchBanner } from "./possible-match-banner";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/app/(app)/leads/[id]/match-actions", () => ({
  linkLeadToAccount: vi.fn(),
  dismissPossibleMatch: vi.fn(),
}));

describe("PossibleMatchBanner e2e", () => {
  it("shows Link and Create new for a possible account match", () => {
    const markup = renderToStaticMarkup(
      createElement(PossibleMatchBanner, {
        leadId: "lead-1",
        canEdit: true,
        candidates: [
          {
            accountId: "acct-1",
            accountName: "Jane Doe",
            propertyId: null,
            rank: "same_account",
            reasons: ["phone"],
          },
        ],
      }),
    );

    expect(markup).toContain('data-testid="possible-match-banner"');
    expect(markup).toContain("Possible match:");
    expect(markup).toContain("Jane Doe");
    expect(markup).toContain('data-testid="possible-match-link"');
    expect(markup).toContain('data-testid="possible-match-create-new"');
    expect(markup).toContain("Link");
    expect(markup).toContain("Create new");
  });
});
