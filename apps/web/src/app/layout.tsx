// apps/web/src/app/layout.tsx — font swap for the Groundwork brand.
// Replaces the Geist import; keeps Geist Mono for code/IDs (globals.css maps --font-mono to --font-geist-mono).
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist_Mono, Source_Sans_3, Source_Serif_4 } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Body + UI. Variable font, so any weight 200–900 works (use 400 / 600 / 700).
const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  display: "swap",
});

// Headings, quote totals, proposal titles. `opsz` lets large sizes pick the display cut.
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  display: "swap",
  axes: ["opsz"],
});

const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: { default: "LawnQuoter", template: "%s | LawnQuoter" },
  description: "Lead-to-quote-to-job platform for lawn care and landscaping companies.",
  // Icons: put favicon.ico, icon.svg, apple-icon.png and opengraph-image.png in src/app/
  // and Next.js wires them up automatically (file conventions), no config needed here.
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#0D1310" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sourceSans.variable} ${sourceSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-svh flex-col bg-background font-sans text-foreground">
        {children}
        <Toaster richColors position="top-right" offset="calc(0.75rem + env(safe-area-inset-top, 0px))" />
      </body>
    </html>
  );
}

/*
 * Numbers: prices, sq ft, hours, percentages and quote totals must use tabular figures
 * so columns line up and totals don't jitter while customers toggle options.
 *   <td className="text-right tabular-nums">$1,601</td>
 *   <p className="font-heading text-3xl font-bold tabular-nums">$1,601 – $1,890</p>
 * Use an en dash with spaces for price ranges ("$1,601 – $1,890").
 */
