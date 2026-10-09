import { describe, expect, it } from "vitest";
import { resolvePdfBrand } from "./pdf-brand";

describe("resolvePdfBrand", () => {
  it("keeps forest and white ink when the tenant color is missing or invalid", () => {
    for (const color of [null, undefined, "", "green", "#fff", "#12345G"]) {
      expect(resolvePdfBrand(color)).toEqual({ primary: "#1E5235", onPrimary: "#FFFFFF" });
    }
  });

  it("uses white ink on a dark tenant color", () => {
    expect(resolvePdfBrand("#1E5235")).toEqual({ primary: "#1E5235", onPrimary: "#FFFFFF" });
    expect(resolvePdfBrand("#000000")).toEqual({ primary: "#000000", onPrimary: "#FFFFFF" });
  });

  it("uses dark ink when white would miss 4.5:1", () => {
    expect(resolvePdfBrand("#F4F6F4")).toEqual({ primary: "#F4F6F4", onPrimary: "#121A16" });
    expect(resolvePdfBrand("#ffffff")).toEqual({ primary: "#ffffff", onPrimary: "#121A16" });
  });
});
