import type { BrandTheme } from "./derive-brand-theme";

/** Plain-language Settings notes. The public page stays quiet and uses the adjusted shades. */
export function brandWarningCopy(theme: BrandTheme): string | null {
  const notes: string[] = [];
  if (theme.warnings.includes("invalid-input")) {
    notes.push("That isn't a hex color, so the page uses the Groundwork green.");
  }
  if (theme.warnings.includes("fill-too-light")) {
    notes.push("Your color is nearly white, so buttons use a darker shade.");
  }
  if (theme.warnings.includes("text-adjusted-light") || theme.warnings.includes("dark-text-on-fill")) {
    notes.push(`Your color is light, so buttons use dark text and links use a darker shade (${theme.light.text}).`);
  }
  if (theme.warnings.includes("text-adjusted-dark")) {
    notes.push("On dark backgrounds, buttons and links use a lighter shade so they stay readable.");
  }
  if (theme.warnings.includes("close-to-error-red")) {
    notes.push("Your color is close to our error red; error messages will still use an icon and wording to stand out.");
  }
  return notes.length > 0 ? notes.join(" ") : null;
}
