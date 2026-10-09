import localFont from "next/font/local";

/** Loaded with the quote page. The family is applied only under [data-heading="sturdy"]. */
export const headingSturdy = localFont({
  src: [
    { path: "./fonts/RobotoSlab-600.ttf", weight: "600", style: "normal" },
    { path: "./fonts/RobotoSlab-700.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-heading-sturdy",
  display: "swap",
  preload: false,
  fallback: ["Georgia", "serif"],
});
