// Groundwork hex for @react-pdf. It does not read CSS variables or oklch. PDFs print on white.
export const pdfColors = {
  ink: "#121A16", // body text
  muted: "#56625B", // secondary text, captions (6.4:1 on white)
  border: "#D9E0DB", // table rules, card borders
  paper: "#FFFFFF",
} as const;
