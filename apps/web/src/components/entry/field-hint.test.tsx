import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FieldHint } from "./field-hint";

describe("FieldHint", () => {
  it("shows the full helper sentence and wraps it on a narrow phone", () => {
    const html = renderToStaticMarkup(
      createElement(FieldHint, null, "Skip takes the stops off this day. Push moves them to the next open day."),
    );
    expect(html).toContain("Skip takes the stops off this day.");
    expect(html).toContain("data-field-hint");
    expect(html).toContain("text-pretty");
    expect(html).toContain("wrap-break-word");
    expect(html).not.toContain("truncate");
    expect(html).not.toContain("line-clamp");
  });
});
