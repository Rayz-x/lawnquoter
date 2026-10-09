import { pdfColors } from "./pdf-colors";


const HEX = /^#[0-9a-fA-F]{6}$/;

function channel(value: number) {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a: string, b: string) {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Tenant `brand_color` from `quote_public` replaces forest on the quote PDF.
 * White ink only when it clears 4.5:1 against that color.
 */
export function resolvePdfBrand(tenantColor: string | null | undefined) {
  if (!tenantColor || !HEX.test(tenantColor)) {
    return { primary: pdfColors.primary, onPrimary: pdfColors.onPrimary };
  }
  const onPrimary = contrast(tenantColor, "#FFFFFF") >= 4.5 ? "#FFFFFF" : pdfColors.ink;
  return { primary: tenantColor, onPrimary };
}
