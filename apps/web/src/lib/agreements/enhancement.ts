/** An enhancement proposal needs a short title. */
export function enhancementTitle(value: string): string | null {
  const title = value.trim();
  if (!title || title.length > 120) return null;
  return title;
}
