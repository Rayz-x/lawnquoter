/**
 * deriveBrandTheme: one tenant hex -> light + dark brand tokens for /q/[token] and the quote PDF.
 *
 * Pure, dependency-free TypeScript. Only the brand-owned tokens are produced; every other token
 * (background, foreground, muted, border, success, warning, destructive) stays Groundwork and is locked.
 *
 * Guarantees (asserted in the tests):
 *  - light.text and dark.text reach >= 4.5:1 on the page background, the card, and the soft tint.
 *  - light.foreground on light.fill and dark.foreground on dark.fill reach >= 4.5:1.
 *  - light.edge and dark.edge reach >= 3:1 against the page (WCAG 1.4.11 non-text contrast).
 *  - Invalid or missing input returns the Groundwork defaults.
 */

export type Hex = `#${string}`;

export type BrandModeTokens = {
  /** Solid fill for primary buttons, checked radios/checkboxes, the top accent bar. */
  fill: Hex;
  /** Text/icon color on `fill`. White when it clears 4.5:1, otherwise dark ink. */
  foreground: Hex;
  /** Brand-colored text on the page: company name fallback, links, "Recommended" text. */
  text: Hex;
  /** Borders that must be visible against the page: selected plan card, light button outline, focus ring. */
  edge: Hex;
  /** Subtle tinted background for the "Recommended" pill and selected plan card. */
  soft: Hex;
};

export type BrandWarning =
  | "invalid-input" // not a hex; defaults used
  | "dark-text-on-fill" // light mode: white failed, dark ink used on buttons
  | "fill-too-light" // light mode: color is nearly white, buttons use the darkened text color instead
  | "text-adjusted-light" // light mode: brand text darkened to reach 4.5:1
  | "text-adjusted-dark" // dark mode: brand lightened to reach 4.5:1
  | "close-to-error-red"; // hue/lightness close to destructive; allowed, but shown as a hint in Settings

export type BrandTheme = {
  source: Hex | null; // normalized input, null when defaults were used
  light: BrandModeTokens;
  dark: BrandModeTokens;
  warnings: BrandWarning[];
};

// Groundwork surfaces (locked).
export const SURFACES = {
  light: { background: "#FFFFFF", card: "#FFFFFF" },
  dark: { background: "#0D1310", card: "#151E19" },
} as const;
export const WHITE: Hex = "#FFFFFF";
export const INK: Hex = "#121A16"; // Groundwork foreground
export const DARK_INK: Hex = "#0B1A11"; // Groundwork dark primary-foreground
const DESTRUCTIVE = "#B42318";

export const GROUNDWORK_DEFAULT: BrandTheme = {
  source: null,
  light: { fill: "#1E5235", foreground: "#FFFFFF", text: "#1E5235", edge: "#1E5235", soft: "#E8EEEA" },
  dark: { fill: "#6CC38F", foreground: "#0B1A11", text: "#6CC38F", edge: "#6CC38F", soft: "#1E3127" },
  warnings: [],
};

// ---------- color math (sRGB <-> OKLab/OKLCH, WCAG luminance) ----------
type RGB = [number, number, number]; // 0..1 gamma-encoded

export function normalizeHex(input: string | null | undefined): Hex | null {
  if (!input) return null;
  const s = input.trim();
  const m3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`.toUpperCase() as Hex;
  const m6 = /^#?([0-9a-f]{6})$/i.exec(s);
  return m6 ? (`#${m6[1]}`.toUpperCase() as Hex) : null;
}

function hexToRgb(hex: string): RGB {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function rgbToHex([r, g, b]: RGB): Hex {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase() as Hex;
}
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLin) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type LCH = { l: number; c: number; h: number };
export function hexToOklch(hex: string): LCH {
  const [r, g, b] = hexToRgb(hex).map(toLin) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}
function oklchToLinear({ l, c, h }: LCH): RGB {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}
const inGamut = (rgb: RGB) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH -> hex, reducing chroma (keeping L and hue) until the color fits sRGB. */
export function oklchToHex(lch: LCH): Hex {
  let c = lch.c;
  let rgb = oklchToLinear({ ...lch, c });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ ...lch, c: mid }))) lo = mid;
      else hi = mid;
    }
    c = lo;
    rgb = oklchToLinear({ ...lch, c });
  }
  return rgbToHex(rgb.map((v) => toGam(Math.min(1, Math.max(0, v)))) as RGB);
}

/**
 * Move lightness (keeping hue, capping chroma) until `against` contrast >= target for every surface.
 * direction "darker" searches L downward from the source, "lighter" upward. Returns the closest passing color.
 */
function adjustToContrast(hex: Hex, surfaces: readonly string[], target: number, direction: "darker" | "lighter", maxChroma = Infinity): Hex {
  const src = hexToOklch(hex);
  const base = { ...src, c: Math.min(src.c, maxChroma) };
  const passes = (h: Hex) => surfaces.every((s) => contrast(h, s) >= target);
  const at = (l: number) => oklchToHex({ ...base, l });
  if (passes(at(base.l))) return at(base.l);
  let lo = direction === "darker" ? 0 : base.l; // lo..hi bracket; we want the passing L closest to base.l
  let hi = direction === "darker" ? base.l : 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const ok = passes(at(mid));
    if (direction === "darker") {
      if (ok) lo = mid;
      else hi = mid;
    } else if (ok) hi = mid;
    else lo = mid;
  }
  // Rounding to 8-bit can land a hair under the target; step further until it passes.
  let l = direction === "darker" ? lo : hi;
  for (let i = 0; i < 200 && !passes(at(l)); i++) l += direction === "darker" ? -0.002 : 0.002;
  return at(Math.min(1, Math.max(0, l)));
}

/** Blend `fg` over `bg` at `amount` (0..1) in sRGB, matching CSS color-mix(in srgb, ...). */
export function mix(fg: string, bg: string, amount: number): Hex {
  const a = hexToRgb(fg);
  const b = hexToRgb(bg);
  return rgbToHex(a.map((v, i) => v * amount + b[i]! * (1 - amount)) as RGB);
}

// ---------- the derivation ----------
const SOFT_LIGHT = 0.1; // tint strength for the light "soft" surface
const SOFT_DARK = 0.18;
const DARK_MAX_CHROMA = 0.17; // keeps dark-mode brand colors from going neon

export function deriveBrandTheme(input: string | null | undefined): BrandTheme {
  const source = normalizeHex(input);
  if (!source) {
    return { ...GROUNDWORK_DEFAULT, warnings: input ? ["invalid-input"] : [] };
  }
  const warnings: BrandWarning[] = [];
  const L = SURFACES.light;
  const D = SURFACES.dark;

  // Light mode -------------------------------------------------------------
  const softL = mix(source, L.background, SOFT_LIGHT);
  const textL = adjustToContrast(source, [L.background, L.card, softL], 4.5, "darker");
  if (textL !== source) warnings.push("text-adjusted-light");

  let fillL: Hex = source;
  if (contrast(fillL, L.background) < 1.2) {
    fillL = textL; // near-white brand: a white-on-white button would vanish
    warnings.push("fill-too-light");
  }
  let fgL: Hex;
  if (contrast(WHITE, fillL) >= 4.5) fgL = WHITE;
  else if (contrast(INK, fillL) >= 4.5) {
    fgL = INK;
    warnings.push("dark-text-on-fill");
  } else {
    // Mid-tone where neither white nor ink reaches 4.5:1: darken the fill until white text passes.
    fillL = adjustToContrast(fillL, [WHITE], 4.5, "darker");
    fgL = WHITE;
  }
  const edgeL = contrast(fillL, L.background) >= 3 ? fillL : textL;

  // Dark mode --------------------------------------------------------------
  // Fill and text share one color (like Groundwork's #6CC38F) so the brand reads the same on buttons and links.
  const seedSoftD = mix(source, D.card, SOFT_DARK);
  const textD = adjustToContrast(source, [D.background, D.card, seedSoftD], 4.5, "lighter", DARK_MAX_CHROMA);
  if (textD !== source) warnings.push("text-adjusted-dark");
  const softD = mix(textD, D.card, SOFT_DARK);
  const textDFinal = contrast(textD, softD) >= 4.5 ? textD : adjustToContrast(textD, [D.background, D.card, softD], 4.5, "lighter", DARK_MAX_CHROMA);
  const fillD = textDFinal;
  const fgD = contrast(DARK_INK, fillD) >= 4.5 ? DARK_INK : WHITE;

  // Hint only: brand color that could be confused with the error red.
  const s = hexToOklch(source);
  const r = hexToOklch(DESTRUCTIVE);
  const dh = Math.min(Math.abs(s.h - r.h), 360 - Math.abs(s.h - r.h));
  if (s.c > 0.1 && dh < 18 && Math.abs(s.l - r.l) < 0.15) warnings.push("close-to-error-red");

  return {
    source,
    light: { fill: fillL, foreground: fgL, text: textL, edge: edgeL, soft: softL },
    dark: { fill: fillD, foreground: fgD, text: textDFinal, edge: fillD, soft: softD },
    warnings,
  };
}

/** CSS custom properties for one mode. Only these tokens are overridable on tenant surfaces. */
export function brandCssVars(t: BrandModeTokens): Record<string, string> {
  return {
    "--primary": t.fill,
    "--primary-foreground": t.foreground,
    "--ring": t.edge,
    "--brand-text": t.text,
    "--brand-edge": t.edge,
    "--brand-soft": t.soft,
  };
}

/** Light brand tokens at higher specificity so the cream quote page stays readable in a dark office session. */
export function quoteEditorialBrandCss(theme: BrandTheme): string {
  const body = Object.entries(brandCssVars(theme.light))
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
  return `.quote-editorial[data-tenant-brand]{${body}}`;
}

/**
 * Server-rendered <style> body for the quote page wrapper. Values are generated hex only,
 * so the string is safe to inline (never interpolate raw user input here).
 */
export function brandStyleSheet(theme: BrandTheme, scope = "[data-tenant-brand]"): string {
  const decl = (v: Record<string, string>) => Object.entries(v).map(([k, val]) => `${k}:${val}`).join(";");
  return `${scope}{${decl(brandCssVars(theme.light))}}.dark ${scope}{${decl(brandCssVars(theme.dark))}}`;
}

/** PDF (always light, prints on white). */
export function pdfBrand(theme: BrandTheme) {
  return {
    rule: theme.light.fill, // decorative 2pt header rule (non-text)
    text: theme.light.text, // company-name fallback wordmark, total, links
    fill: theme.light.fill, // "Accept online" button-like block
    onFill: theme.light.foreground,
    soft: theme.light.soft, // "Recommended" pill background
  };
}
