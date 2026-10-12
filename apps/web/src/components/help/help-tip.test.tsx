import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { defaultModifiers } from "@lawnquoter/pricing-engine";
import { ModifiersForm } from "@/app/(app)/settings/pricing/modifiers-form";
import { HelpTip } from "./help-tip";

describe("HelpTip placement", () => {
  it("opens below the icon and flips only when that side does not fit", () => {
    const html = renderToStaticMarkup(
      createElement(HelpTip, {
        label: "Help for property adjustments",
        text: "Slope, a narrow gate, and the season change the price.",
        href: "/help/pricing#slope-gate-obstacles-and-stairs",
      }),
    );
    expect(html).toContain('data-side="bottom"');
    expect(html).toContain('data-collision-side="flip"');
    expect(html).toContain('data-collision-fallback="end"');
    expect(html).not.toContain('data-side="top"');
  });

  it("sits beside the Property adjustments title instead of under the description", () => {
    const html = renderToStaticMarkup(
      createElement(ModifiersForm, { priceListId: "list", modifiers: defaultModifiers() }),
    );
    const title = html.indexOf("Property adjustments");
    const tip = html.indexOf('aria-label="Help for property adjustments"');
    const description = html.indexOf("Automatic price changes for tricky yards.");
    expect(title).toBeGreaterThan(-1);
    expect(tip).toBeGreaterThan(title);
    expect(description).toBeGreaterThan(tip);
  });
});
