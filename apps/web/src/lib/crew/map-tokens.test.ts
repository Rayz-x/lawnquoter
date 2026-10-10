import { describe, expect, it } from "vitest";
import { mapTokensFromStyle } from "./map-tokens";

describe("mapTokensFromStyle", () => {
  it("maps Groundwork CSS variables into map paint tokens", () => {
    const style = {
      getPropertyValue(name: string) {
        return (
          {
            "--brass": "oklch(0.677 0.136 74.4)",
            "--primary": "#123d25",
            "--muted-foreground": "#2c3832",
            "--background": "#ffffff",
            "--foreground": "#05110a",
          }[name] ?? ""
        );
      },
    };

    const toRgb = (color: string) => (color.startsWith("oklch") ? "rgb(200, 137, 28)" : color);

    expect(mapTokensFromStyle(style, "white", toRgb)).toEqual({
      brass: "rgb(200, 137, 28)",
      primary: "#123d25",
      mutedForeground: "#2c3832",
      background: "#ffffff",
      foreground: "#05110a",
      pinLabel: "white",
    });
  });

  it("throws when a required token is missing", () => {
    expect(() =>
      mapTokensFromStyle({ getPropertyValue: () => "" }, "white"),
    ).toThrow(/Missing CSS var --brass/);
  });
});
