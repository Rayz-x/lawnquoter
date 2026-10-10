/**
 * Map paint colours from Groundwork CSS variables on a themed element
 * (crew shell with light / dark / sun). MapLibre needs resolved sRGB values
 * (it rejects `oklch(...)` from globals.css).
 */
export type MapTokens = {
  brass: string;
  /** Forest / active pin — light `--primary` (Groundwork primary-dark). */
  primary: string;
  mutedForeground: string;
  background: string;
  foreground: string;
  /** White label on coloured pins; taken from light `--primary-foreground`. */
  pinLabel: string;
};

type CssVarReader = Pick<CSSStyleDeclaration, "getPropertyValue">;

const TOKEN_VARS = {
  brass: "--brass",
  primary: "--primary",
  mutedForeground: "--muted-foreground",
  background: "--background",
  foreground: "--foreground",
} as const;

function readVar(style: CssVarReader, name: string): string {
  const value = style.getPropertyValue(name).trim();
  if (!value) throw new Error(`Missing CSS var ${name} for map tokens`);
  return value;
}

/** Convert any CSS colour (including oklch) to an `rgba()` MapLibre accepts. */
export function cssColorToRgb(color: string): string {
  if (typeof document === "undefined") return color;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return color;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

/** Pure mapper for tests and for `readMapTokens`. */
export function mapTokensFromStyle(style: CssVarReader, pinLabel: string, toRgb: (c: string) => string = (c) => c): MapTokens {
  return {
    brass: toRgb(readVar(style, TOKEN_VARS.brass)),
    primary: toRgb(readVar(style, TOKEN_VARS.primary)),
    mutedForeground: toRgb(readVar(style, TOKEN_VARS.mutedForeground)),
    background: toRgb(readVar(style, TOKEN_VARS.background)),
    foreground: toRgb(readVar(style, TOKEN_VARS.foreground)),
    pinLabel: toRgb(pinLabel),
  };
}

/** Resolve Groundwork tokens from a crew-themed element (or documentElement). */
export function readMapTokens(from: Element): MapTokens {
  return mapTokensFromStyle(getComputedStyle(from), readLightPinLabel(), cssColorToRgb);
}

/** Pin numbers stay white on brass / forest / muted pins in every crew theme. */
function readLightPinLabel(): string {
  if (typeof document === "undefined") return "white";
  const probe = document.createElement("div");
  probe.className = "crew-display-light";
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  document.body.appendChild(probe);
  try {
    const value = getComputedStyle(probe).getPropertyValue("--primary-foreground").trim();
    return value || "white";
  } finally {
    probe.remove();
  }
}
