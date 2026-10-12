import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FieldHint } from "./field";

describe("FieldHint", () => {
  it("shows one sentence that can wrap on a phone", () => {
    const markup = renderToStaticMarkup(
      createElement(FieldHint, { id: "company-hint" }, "The name customers see on quotes and invoices."),
    );
    expect(markup).toContain("The name customers see on quotes and invoices.");
    expect(markup).toContain('data-slot="field-hint"');
    expect(markup).toContain('id="company-hint"');
    expect(markup).toContain("break-words");
    expect(markup).toContain("text-pretty");
    expect(markup).toContain("w-full");
  });
});
