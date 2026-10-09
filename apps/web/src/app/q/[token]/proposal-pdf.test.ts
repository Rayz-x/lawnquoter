import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

function pdfText(bytes: Buffer): string | null {
  const probe = spawnSync("pdftotext", ["-v"], { encoding: "utf8" });
  if (probe.error) return null;
  const dir = mkdtempSync(join(tmpdir(), "lq-pdf-"));
  const file = join(dir, "quote.pdf");
  try {
    writeFileSync(file, bytes);
    const out = spawnSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
    if (out.status !== 0) return null;
    return out.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("quote PDF footer", () => {
  it("repeats the powered-by footer on every page of a long quote", async () => {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    const { ProposalPdf } = await import("./proposal-pdf");
    const items = Array.from({ length: 40 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      name: `Line ${index + 1}`,
      description: "A longer description so the quote wraps onto several pages of the letter sheet.",
      state: "optional",
      option_group: null,
      option_tier: "none",
      price: 25 + index,
      qty: 1,
      unit: "each",
      selected: index < 28,
    }));
    const buf = await renderToBuffer(
      ProposalPdf({
        payload: {
          title: "Season proposal",
          number: 1042,
          intro: "Thanks for the visit.",
          notes_customer: null,
          org: {
            name: "Sunny Side Lawn",
            phone: "(555) 010-0142",
            email: "hello@sunnyside.example",
            website: null,
            brand_color: "#F7D84A",
            logo_url: null,
            logo_dark_url: null,
            logo_raster_url: null,
            logo_width: null,
            logo_height: null,
            logo_shows_name: null,
            logo_needs_chip: false,
            heading_font: "classic",
          },
          items,
        },
        selectedIds: null,
        logo: null,
        quoteUrl: "http://localhost:3000/q/sample",
      }),
    );
    const bytes = Buffer.from(buf);
    const pages = bytes.toString("latin1").match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
    expect(pages).toBeGreaterThanOrEqual(3);
    const text = pdfText(bytes);
    if (text) {
      const labels = text.match(/Quote #1042 · Page \d+ of \d+/g) ?? [];
      expect(labels).toHaveLength(pages);
      expect(text.match(/Powered by LawnQuoter/g)).toHaveLength(pages);
    }
  });
});
