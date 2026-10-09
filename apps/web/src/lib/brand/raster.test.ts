import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBrandingRaster, RASTER_BYTE_CAP, RASTER_FETCH_TIMEOUT_MS } from "./raster";

const ORG = "e606fd84-cbe4-432f-8f25-e9b2a7f88b75";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
});

describe("loadBrandingRaster", () => {
  it("does not fetch an absolute URL", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadBrandingRaster("https://evil.test/logo.png", ORG)).toBeNull();
    expect(await loadBrandingRaster(`${ORG}/logo.png`, "00000000-0000-4000-8000-000000000099")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches only this project's storage URL, with a 3s timeout and a 2 MB cap", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co/";
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(new AbortController().signal);
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`https://project.supabase.co/storage/v1/object/public/org-branding/${ORG}/logo-raster.png`);
      expect(init?.redirect).toBe("error");
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= RASTER_BYTE_CAP + chunk.byteLength) {
            controller.close();
            return;
          }
          controller.enqueue(chunk);
          sent += chunk.byteLength;
        },
      });
      return new Response(stream, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadBrandingRaster(`${ORG}/logo-raster.png`, ORG)).toBeNull();
    expect(timeout).toHaveBeenCalledWith(RASTER_FETCH_TIMEOUT_MS);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns a small PNG from the project bucket", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(png, { status: 200 })),
    );
    const bytes = await loadBrandingRaster(`${ORG}/logo.png`, ORG);
    expect(bytes?.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});
