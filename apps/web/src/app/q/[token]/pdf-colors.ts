// Groundwork hex for @react-pdf. It does not read CSS variables or oklch. PDFs print on white.
export const pdfColors = {
  ink: "#121A16", // body text
  muted: "#56625B", // secondary text, captions (6.4:1 on white)
  border: "#D9E0DB", // table rules, card borders
  surface: "#F4F6F4", // section bands
  paper: "#FFFFFF",
  primary: "#1E5235", // headings, header rule
  onPrimary: "#FFFFFF",
  brass: "#C8891C", // recommended pill
  onBrass: "#1A1205",
  brassText: "#8A5A0B", // brass text on white
  success: "#17703A",
  warning: "#A3530A",
  destructive: "#B42318",
  successSoft: "#E3EEE7",
  warningSoft: "#F4EAE2",
  destructiveSoft: "#F6E5E3",
} as const;
