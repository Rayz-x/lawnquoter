import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaidRoutingNotice } from "./paid-routing-notice";

describe("paid routing notice", () => {
  it("tells the office the paid service is off until a key is added", () => {
    const html = renderToStaticMarkup(createElement(PaidRoutingNotice, { connected: false }));
    expect(html).toContain("Paid routing is not connected");
    expect(html).toContain("ROUTING_API_KEY");
  });

  it("stays quiet once the routing service is connected", () => {
    const html = renderToStaticMarkup(createElement(PaidRoutingNotice, { connected: true }));
    expect(html).toBe("");
  });
});
