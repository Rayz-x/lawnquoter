import type { PublicOrg } from "@/lib/brand/public-org";

export function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function orgFromPayload(raw: unknown): PublicOrg {
  const org = (raw ?? {}) as Record<string, unknown>;
  return {
    name: text(org.name) ?? "Quote",
    phone: text(org.phone),
    email: text(org.email),
    website: text(org.website),
    brand_color: text(org.brand_color),
    logo_url: text(org.logo_url),
    logo_dark_url: text(org.logo_dark_url),
    logo_raster_url: text(org.logo_raster_url),
    logo_width: typeof org.logo_width === "number" ? org.logo_width : null,
    logo_height: typeof org.logo_height === "number" ? org.logo_height : null,
    logo_shows_name: typeof org.logo_shows_name === "boolean" ? org.logo_shows_name : null,
    logo_needs_chip: org.logo_needs_chip === true,
    heading_font: text(org.heading_font),
    address_line1: text(org.address_line1),
    address_line2: text(org.address_line2),
    city: text(org.city),
    region: text(org.region),
    postal_code: text(org.postal_code),
    country: text(org.country),
  };
}
