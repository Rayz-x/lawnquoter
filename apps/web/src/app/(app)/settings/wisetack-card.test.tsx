import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WISETACK_NOT_CONNECTED } from "@/lib/billing/wisetack";
import { WisetackCard } from "./wisetack-card";

describe("Wisetack settings card", () => {
  it("says the feature is off until a key is set", () => {
    const previous = process.env.WISETACK_PREQUAL_URL;
    delete process.env.WISETACK_PREQUAL_URL;
    const markup = renderToStaticMarkup(createElement(WisetackCard));
    if (previous === undefined) delete process.env.WISETACK_PREQUAL_URL;
    else process.env.WISETACK_PREQUAL_URL = previous;
    expect(markup).toContain(WISETACK_NOT_CONNECTED);
  });
});
