import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { geocodeAddress } from "./geocode";

const ENDPOINT =
  "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates";

const ADDRESS = "380 New York St, Redlands, CA 92373";

const esriCandidate = {
  spatialReference: { wkid: 4326, latestWkid: 4326 },
  candidates: [
    {
      address: "380 New York St, Redlands, California, 92373",
      location: { x: -117.194835113918, y: 34.057241819826 },
      score: 100,
      attributes: {
        LongLabel: "380 New York St, Redlands, CA, 92373, USA",
        ShortLabel: "380 New York St",
        StAddr: "380 New York St",
        City: "Redlands",
        Region: "California",
        RegionAbbr: "CA",
        Postal: "92373",
        Country: "USA",
        MatchID: "AQFV9QAAmeQBAJUB",
      },
    },
    {
      address: "Wrong second candidate",
      location: { x: 0, y: 0 },
      score: 10,
      attributes: { LongLabel: "Wrong", MatchID: "other" },
    },
  ],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("geocodeAddress", () => {
  it("asks Esri to store the result and keeps the key off the request URL", async () => {
    vi.stubEnv("ARCGIS_API_KEY", "server-key");
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "google-key");
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse(esriCandidate),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await geocodeAddress(`  ${ADDRESS}  `);

    expect(result).toEqual({
      formattedAddress: "380 New York St, Redlands, CA, 92373, USA",
      placeId: "AQFV9QAAmeQBAJUB",
      location: { type: "Point", coordinates: [-117.194835113918, 34.057241819826] },
      addressLine1: "380 New York St",
      city: "Redlands",
      region: "CA",
      postalCode: "92373",
      country: "US",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    if (url == null || init == null) throw new Error("expected a geocode request");
    const parsed = new URL(String(url));
    expect(`${parsed.origin}${parsed.pathname}`).toBe(ENDPOINT);
    expect(parsed.searchParams.get("SingleLine")).toBe(ADDRESS);
    expect(parsed.searchParams.get("forStorage")).toBe("true");
    expect(parsed.searchParams.get("f")).toBe("json");
    expect(parsed.searchParams.get("outSR")).toBe("4326");
    expect(parsed.searchParams.get("maxLocations")).toBe("1");
    expect(parsed.searchParams.get("token")).toBeNull();
    expect(parsed.toString()).not.toContain("server-key");
    expect(parsed.toString()).not.toContain("google");
    const headers = new Headers(init.headers);
    expect(headers.get("X-Esri-Authorization")).toBe("Bearer server-key");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("falls back to the candidate address and a null place id when those attributes are blank", async () => {
    vi.stubEnv("ARCGIS_API_KEY", "server-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          candidates: [
            {
              address: "1 Main St, Austin, Texas, 78701",
              location: { x: -97.74, y: 30.27 },
              attributes: { LongLabel: "  ", MatchID: "", StAddr: "", ShortLabel: "1 Main St", Country: "US" },
            },
          ],
        }),
      ),
    );

    await expect(geocodeAddress("1 Main St, Austin, TX 78701")).resolves.toMatchObject({
      formattedAddress: "1 Main St, Austin, Texas, 78701",
      placeId: null,
      addressLine1: "1 Main St",
      country: "US",
    });
  });

  it("does not call a geocoder when the server key or address is missing", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "google-key");
    vi.stubEnv("ARCGIS_API_KEY", "   ");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(geocodeAddress(ADDRESS)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("ARCGIS_API_KEY", "server-key");
    await expect(geocodeAddress("   ")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when Esri has no candidates", async () => {
    vi.stubEnv("ARCGIS_API_KEY", "server-key");
    const fetchMock = vi.fn(async () => jsonResponse({ candidates: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(geocodeAddress(ADDRESS)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns null when the candidate has no coordinates or address", async () => {
    vi.stubEnv("ARCGIS_API_KEY", "server-key");
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        candidates: [{ address: "", location: { x: Number.NaN, y: 1 }, attributes: {} }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(geocodeAddress(ADDRESS)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns null on an HTTP error or an Esri error body", async () => {
    vi.stubEnv("ARCGIS_API_KEY", "server-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 403, message: "denied" } }, 403))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 498, message: "Invalid token." } }, 200),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(geocodeAddress(ADDRESS)).resolves.toBeNull();
    await expect(geocodeAddress(ADDRESS)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when the geocoder times out or the network fails", async () => {
    vi.stubEnv("ARCGIS_API_KEY", "server-key");
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      expect(ms).toBe(8_000);
      const controller = new AbortController();
      controller.abort();
      return controller.signal;
    });
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => {
      if (init?.signal?.aborted) {
        return Promise.reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
      }
      return Promise.reject(new Error("network down"));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(geocodeAddress(ADDRESS)).resolves.toBeNull();
    expect(timeout).toHaveBeenCalledWith(8_000);
    expect(fetchMock).toHaveBeenCalledOnce();

    timeout.mockRestore();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(geocodeAddress(ADDRESS)).resolves.toBeNull();
  });

  it("returns null when the response is not JSON", async () => {
    vi.stubEnv("ARCGIS_API_KEY", "server-key");
    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(geocodeAddress(ADDRESS)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe("geocoding license surface", () => {
  it("does not keep a Google geocoding client", () => {
    const source = readFileSync(new URL("./geocode.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/googleapis|GOOGLE_MAPS|places\.googleapis/);
  });
});
