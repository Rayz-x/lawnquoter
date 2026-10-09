import { describe, expect, it } from "vitest";
import { contrast, deriveBrandTheme, pdfBrand } from "@/lib/brand/derive-brand-theme";

describe("pdfBrand", () => {
  it("uses Groundwork forest and white ink when the tenant color is missing or invalid", () => {
    for (const color of [null, undefined, "", "green", "#12345G"]) {
      expect(pdfBrand(deriveBrandTheme(color))).toMatchObject({
        fill: "#1E5235",
        onFill: "#FFFFFF",
        text: "#1E5235",
      });
    }
  });

  it("keeps white ink on a dark tenant color", () => {
    expect(pdfBrand(deriveBrandTheme("#1E5235"))).toMatchObject({ fill: "#1E5235", onFill: "#FFFFFF", text: "#1E5235" });
    expect(pdfBrand(deriveBrandTheme("#000000")).onFill).toBe("#FFFFFF");
  });

  it("uses the derived text shade, not the raw fill, for a light yellow", () => {
    const brand = pdfBrand(deriveBrandTheme("#F7D84A"));
    expect(brand.fill).toBe("#F7D84A");
    expect(brand.text).toBe("#877300");
    expect(brand.onFill).toBe("#121A16");
    expect(contrast(brand.text, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  it("does not print a near-white fill", () => {
    const brand = pdfBrand(deriveBrandTheme("#F4F6F4"));
    expect(contrast(brand.onFill, brand.fill)).toBeGreaterThanOrEqual(4.5);
    expect(brand.text).not.toBe("#F4F6F4");
  });
});
