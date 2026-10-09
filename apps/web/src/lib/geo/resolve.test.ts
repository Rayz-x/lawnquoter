import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./geocode", () => ({
  geocodeAddress: vi.fn(async () => null),
}));
vi.mock("./parcel", () => ({
  lookupParcel: vi.fn(async () => null),
}));
vi.mock("./footprint", () => ({
  lookupFootprint: vi.fn(async () => null),
}));

import { resolvePropertyGeo } from "./resolve";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolvePropertyGeo", () => {
  it("names ARCGIS_API_KEY when stored geocoding is not configured", async () => {
    vi.stubEnv("ARCGIS_API_KEY", "  ");
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "unused-google-key");
    const result = await resolvePropertyGeo("1 Main St, Austin, TX 78701");
    expect(result.geocode).toBeNull();
    expect(result.parcel).toBeNull();
    expect(result.footprint).toBeNull();
    expect(result.warnings).toEqual(["Geocoding is not configured (ARCGIS_API_KEY)."]);
  });

  it("reports a geocode miss without blaming configuration when the key is set", async () => {
    vi.stubEnv("ARCGIS_API_KEY", "server-key");
    const result = await resolvePropertyGeo("1 Main St, Austin, TX 78701");
    expect(result.warnings[0]).toBe("Address could not be geocoded.");
  });
});
