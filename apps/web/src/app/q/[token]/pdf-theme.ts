// Groundwork palette + fonts for @react-pdf/renderer quote PDFs (light only; PDFs print on white).
// @react-pdf does not read CSS variables or oklch, so these are plain hex.
import "server-only";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

export const pdfColors = {
  ink: "#121A16", // body text
  muted: "#56625B", // secondary text, captions (6.4:1 on white)
  border: "#D9E0DB", // table rules, card borders
  surface: "#F4F6F4", // section bands, measurement bar
  paper: "#FFFFFF",
  primary: "#1E5235", // headings accents, header band, accept CTA
  onPrimary: "#FFFFFF",
  brass: "#C8891C", // "Recommended" pill fill, thin accent rules
  onBrass: "#1A1205",
  brassText: "#8A5A0B", // brass-colored text on white
  success: "#17703A", // "Included", "Accepted"
  warning: "#A3530A", // "Pending site check"
  destructive: "#B42318", // "Expired", "Declined"
  // Soft pill backgrounds (12% tint on white) for status badges
  successSoft: "#E3EEE7",
  warningSoft: "#F4EAE2",
  destructiveSoft: "#F6E5E3",
} as const;

const fontsDir = path.join(process.cwd(), "src/app/q/[token]/fonts");

Font.register({
  family: "Source Sans 3",
  fonts: [
    { src: path.join(fontsDir, "SourceSans3-Regular.ttf"), fontWeight: 400 },
    { src: path.join(fontsDir, "SourceSans3-Italic.ttf"), fontWeight: 400, fontStyle: "italic" },
    { src: path.join(fontsDir, "SourceSans3-SemiBold.ttf"), fontWeight: 600 },
    { src: path.join(fontsDir, "SourceSans3-Bold.ttf"), fontWeight: 700 },
  ],
});
Font.register({
  family: "Source Serif 4",
  fonts: [
    { src: path.join(fontsDir, "SourceSerif4-Regular.ttf"), fontWeight: 400 },
    { src: path.join(fontsDir, "SourceSerif4-SemiBold.ttf"), fontWeight: 600 },
    { src: path.join(fontsDir, "SourceSerif4-Bold.ttf"), fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

export const pdfFonts = { body: "Source Sans 3", heading: "Source Serif 4" } as const;

/** Raster mark for the "Powered by LawnQuoter" footer. react-pdf cannot load SVG. */
export const pdfMarkPath = path.join(process.cwd(), "public/brand/lq-mark-256.png");

const HEX = /^#[0-9a-fA-F]{6}$/;

function channel(value: number) {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

function contrast(a: string, b: string) {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

/** Tenant color replaces forest on the quote PDF. White ink only when it clears 4.5:1. */
export function resolvePdfBrand(tenantColor: string | null | undefined) {
  if (!tenantColor || !HEX.test(tenantColor)) {
    return { primary: pdfColors.primary, onPrimary: pdfColors.onPrimary };
  }
  const onPrimary = contrast(tenantColor, "#FFFFFF") >= 4.5 ? "#FFFFFF" : pdfColors.ink;
  return { primary: tenantColor, onPrimary };
}
