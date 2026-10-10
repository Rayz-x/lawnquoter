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

    expect(mapTokensFromStyle(style, "white")).toEqual({
      brass: "oklch(0.677 0.136 74.4)",
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
