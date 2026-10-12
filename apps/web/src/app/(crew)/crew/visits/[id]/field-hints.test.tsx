import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IrrigationZoneForm } from "./irrigation-zone-form";
import { SnowEventForm } from "./snow-event-form";

describe("crew snow and irrigation hints", () => {
  it("explains the snow log fields", () => {
    const html = renderToStaticMarkup(
      createElement(SnowEventForm, { visitId: "v", userId: "u", orgId: "o", startOpen: true }),
    );
    expect(html).toContain("When you started clearing snow.");
    expect(html).toContain("Salt, sand, or anything else you put down.");
    expect(html).toContain("wrap-break-word");
    expect(html).not.toContain("truncate");
  });

  it("explains the irrigation zone note", () => {
    const html = renderToStaticMarkup(
      createElement(IrrigationZoneForm, { visitId: "v", userId: "u", orgId: "o", startOpen: true }),
    );
    expect(html).toContain("The zone number on the controller.");
    expect(html).toContain("What you found, such as a broken head or a dry zone.");
  });
});
