const SKIPPED = new Set(["&", "and", "llc", "inc", "co", "co.", "company", "the"]);

/** 1–2 letters from the first two words, skipping "&", "and", "LLC", "Inc", "Co." */
export function companyInitials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .filter((word) => word.length > 0 && !SKIPPED.has(word.toLowerCase()));
  const letters = words.slice(0, 2).map((word) => word[0]!.toUpperCase());
  return letters.join("") || "•";
}

export function logoShowsName(org: {
  logo_url: string | null;
  logo_shows_name: boolean | null;
  logo_width: number | null;
  logo_height: number | null;
}): boolean {
  if (!org.logo_url) return true;
  if (org.logo_shows_name != null) return org.logo_shows_name;
  if (!org.logo_width || !org.logo_height) return true;
  return org.logo_width / org.logo_height <= 1.6;
}
