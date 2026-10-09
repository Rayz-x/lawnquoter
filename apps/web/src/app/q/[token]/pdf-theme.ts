import "server-only";
import path from "node:path";
import { Font } from "@react-pdf/renderer";
import { pdfColors } from "./pdf-colors";

export { pdfColors };

const fontsDir = path.join(process.cwd(), "src/app/q/[token]/fonts");

Font.register({
  family: "Source Sans 3",
  fonts: [
    { src: path.join(fontsDir, "SourceSans3-Regular.ttf"), fontWeight: 400 },
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
Font.register({
  family: "Roboto Slab",
  fonts: [
    { src: path.join(fontsDir, "RobotoSlab-600.ttf"), fontWeight: 600 },
    { src: path.join(fontsDir, "RobotoSlab-700.ttf"), fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

export const pdfFonts = { body: "Source Sans 3", heading: "Source Serif 4" } as const;

export function pdfHeadingFamily(font: string | null | undefined) {
  if (font === "clean") return pdfFonts.body;
  if (font === "sturdy") return "Roboto Slab";
  return pdfFonts.heading;
}

/** Raster mark for the "Powered by LawnQuoter" footer. react-pdf cannot load SVG. */
export const pdfMarkPath = path.join(process.cwd(), "public/brand/lq-mark-256.png");

export { pdfBrand } from "./pdf-brand";
