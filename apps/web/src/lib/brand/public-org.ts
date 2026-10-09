export type HeadingFont = "classic" | "clean" | "sturdy";

export type PublicOrg = {
  name: string;
  phone: string | null;
  email: string | null;
  website?: string | null;
  brand_color: string | null;
  logo_url: string | null;
  logo_dark_url: string | null;
  logo_raster_url: string | null;
  logo_width: number | null;
  logo_height: number | null;
  logo_shows_name: boolean | null;
  logo_needs_chip: boolean;
  heading_font: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country?: string | null;
};

export function headingFontOf(value: string | null | undefined): HeadingFont {
  if (value === "clean" || value === "sturdy") return value;
  return "classic";
}

export function formatOrgAddress(org: PublicOrg): string[] {
  const cityLine = [org.city, [org.region, org.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [org.address_line1, org.address_line2, cityLine].filter((line): line is string => Boolean(line));
}
