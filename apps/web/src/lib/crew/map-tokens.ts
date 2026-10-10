/**
 * Map paint colours from Groundwork CSS variables on a themed element
 * (crew shell with light / dark / sun). MapLibre needs resolved values.
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

/** Pure mapper for tests and for `readMapTokens`. */
export function mapTokensFromStyle(style: CssVarReader, pinLabel: string): MapTokens {
  return {
    brass: readVar(style, TOKEN_VARS.brass),
    primary: readVar(style, TOKEN_VARS.primary),
    mutedForeground: readVar(style, TOKEN_VARS.mutedForeground),
    background: readVar(style, TOKEN_VARS.background),
    foreground: readVar(style, TOKEN_VARS.foreground),
    pinLabel,
  };
}

/** Resolve Groundwork tokens from a crew-themed element (or documentElement). */
export function readMapTokens(from: Element): MapTokens {
  return mapTokensFromStyle(getComputedStyle(from), readLightPinLabel());
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
