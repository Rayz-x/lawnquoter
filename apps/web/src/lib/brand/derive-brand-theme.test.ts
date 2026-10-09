import { describe, expect, it } from "vitest";
import {
  GROUNDWORK_DEFAULT,
  SURFACES,
  brandStyleSheet,
  contrast,
  deriveBrandTheme,
  normalizeHex,
} from "./derive-brand-theme";

const SAMPLES = [
  "#1D5FAF", // Bluewater blue
  "#A4262C", // Red Oak deep red
  "#F7D84A", // Sunny Side yellow (dark-text fallback)
  "#0F766E", // Prairie teal
  "#FF6A00", // safety orange (mid-tone)
  "#808080", // neutral mid-gray
  "#FFFFFF", // white (fill-too-light)
  "#FAFAF5", // near white
  "#000000", // black
  "#0A1F44", // navy (dark-mode lightening)
  "#7CFC00", // neon lime
  "#1E5235", // Groundwork forest
];

function rand(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}
const r = rand(42);
const RANDOM = Array.from({ length: 400 }, () =>
  `#${Math.floor(r() * 0xffffff).toString(16).padStart(6, "0")}`,
);

describe("normalizeHex", () => {
  it("accepts 3- and 6-digit hex with or without #", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("1d5faf")).toBe("#1D5FAF");
    expect(normalizeHex(" #1D5FAF ")).toBe("#1D5FAF");
  });
  it("rejects anything else", () => {
    for (const v of ["", "blue", "#12345G", "#1234", "rgb(0,0,0)", null, undefined]) expect(normalizeHex(v)).toBeNull();
  });
});

describe("deriveBrandTheme", () => {
  it("falls back to Groundwork for missing or invalid input", () => {
    expect(deriveBrandTheme(null).light).toEqual(GROUNDWORK_DEFAULT.light);
    expect(deriveBrandTheme("not-a-color").warnings).toContain("invalid-input");
    expect(deriveBrandTheme("not-a-color").dark).toEqual(GROUNDWORK_DEFAULT.dark);
  });

  it.each([...SAMPLES, ...RANDOM])("meets WCAG for %s", (hex) => {
    const t = deriveBrandTheme(hex);
    // Light
    expect(contrast(t.light.foreground, t.light.fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.light.text, SURFACES.light.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.light.text, t.light.soft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.light.edge, SURFACES.light.background)).toBeGreaterThanOrEqual(3);
    // Dark
    expect(contrast(t.dark.foreground, t.dark.fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.dark.text, SURFACES.dark.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.dark.text, SURFACES.dark.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.dark.text, t.dark.soft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.dark.edge, SURFACES.dark.card)).toBeGreaterThanOrEqual(3);
  });

  it("keeps a dark brand as-is in light mode with white text", () => {
    const t = deriveBrandTheme("#1D5FAF");
    expect(t.light.fill).toBe("#1D5FAF");
    expect(t.light.text).toBe("#1D5FAF");
    expect(t.light.foreground).toBe("#FFFFFF");
    expect(t.warnings).not.toContain("dark-text-on-fill");
  });

  it("uses dark ink on a light yellow and darkens the text color", () => {
    const t = deriveBrandTheme("#F7D84A");
    expect(t.light.fill).toBe("#F7D84A");
    expect(t.light.foreground).toBe("#121A16");
    expect(t.light.text).not.toBe("#F7D84A");
    expect(t.light.edge).toBe(t.light.text); // yellow fill is < 3:1 on white, so outlines use the text color
    expect(t.warnings).toEqual(expect.arrayContaining(["dark-text-on-fill", "text-adjusted-light"]));
  });

  it("swaps a near-white fill for the darkened text color", () => {
    const t = deriveBrandTheme("#FFFFFF");
    expect(t.warnings).toContain("fill-too-light");
    expect(t.light.fill).toBe(t.light.text);
  });

  it("lightens a navy brand for dark mode and keeps the hue family", () => {
    const t = deriveBrandTheme("#0A1F44");
    expect(t.warnings).toContain("text-adjusted-dark");
    expect(t.dark.fill).not.toBe("#0A1F44");
    expect(t.dark.foreground).toBe("#0B1A11");
  });

  it("is deterministic", () => {
    expect(deriveBrandTheme("#A4262C")).toEqual(deriveBrandTheme("#a4262c"));
  });

  it("flags a red that could be read as an error", () => {
    expect(deriveBrandTheme("#B91C1C").warnings).toContain("close-to-error-red");
    expect(deriveBrandTheme("#1D5FAF").warnings).not.toContain("close-to-error-red");
  });

  it("emits a scoped stylesheet with only hex values", () => {
    const css = brandStyleSheet(deriveBrandTheme("#1D5FAF"));
    expect(css).toMatch(/^\[data-tenant-brand\]\{--primary:#1D5FAF;/);
    expect(css).toContain(".dark [data-tenant-brand]{");
    expect(css).not.toMatch(/[<>"'`]/);
  });
});
