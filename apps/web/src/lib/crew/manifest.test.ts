import { describe, expect, it } from "vitest";
import { crewManifest } from "./manifest";

describe("crewManifest", () => {
  it("installs as LawnQuoter Crew and opens today's route", () => {
    const manifest = crewManifest();
    expect(manifest.name).toBe("LawnQuoter Crew");
    expect(manifest.short_name).toBe("Crew");
    expect(manifest.id).toBe("/crew");
    expect(manifest.scope).toBe("/crew/");
    expect(manifest.start_url).toBe("/crew/today?source=pwa");
    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("portrait");
    expect(manifest.theme_color).toBe("#1E5235");
    expect(manifest.shortcuts[0]?.url).toBe("/crew/today");
    expect(manifest.icons.map((icon) => icon.src)).toEqual([
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-maskable-512.png",
    ]);
  });
});
