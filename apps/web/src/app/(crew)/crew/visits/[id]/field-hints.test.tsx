import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IrrigationZoneForm } from "./irrigation-zone-form";
import { SnowEventForm } from "./snow-event-form";

describe("crew snow and irrigation hints", () => {
  it("explains snow depth with a help tip instead of a helper line", () => {
    const html = renderToStaticMarkup(
      createElement(SnowEventForm, { visitId: "v", userId: "u", orgId: "o", startOpen: true }),
    );
    expect(html).toContain("Help for snow depth");
    expect(html).toContain("Started");
    expect(html).toContain("Materials");
    expect(html).not.toContain("When you started clearing snow.");
    expect(html).not.toContain("Salt, sand, or anything else you put down.");
  });

  it("labels the irrigation zone note without a helper line", () => {
    const html = renderToStaticMarkup(
      createElement(IrrigationZoneForm, { visitId: "v", userId: "u", orgId: "o", startOpen: true }),
    );
    expect(html).toContain("Zone");
    expect(html).toContain("What you found");
    expect(html).not.toContain("The zone number on the controller.");
    expect(html).not.toContain("What you found, such as a broken head or a dry zone.");
  });
});
