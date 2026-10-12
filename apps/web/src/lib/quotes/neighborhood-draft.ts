export type MemoryLine = {
  name: string;
  price: number;
  qty: number;
  unit: string;
  state: "included" | "recommended" | "optional";
};

export type MemoryQuote = {
  id: string;
  postalCode: string;
  lotSqft: number | null;
  lat: number | null;
  lng: number | null;
  lines: MemoryLine[];
};

export type DraftProbe = {
  postalCode: string;
  lotSqft: number | null;
  lat: number | null;
  lng: number | null;
};

function miles(left: { lat: number; lng: number }, right: { lat: number; lng: number }): number {
  const lat1 = (left.lat * Math.PI) / 180;
  const lat2 = (right.lat * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((right.lng - left.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function score(probe: DraftProbe, quote: MemoryQuote): number {
  const size =
    probe.lotSqft && quote.lotSqft ? Math.abs(probe.lotSqft - quote.lotSqft) / Math.max(probe.lotSqft, 1) : 1;
  const samePostal = probe.postalCode.trim().toLowerCase() === quote.postalCode.trim().toLowerCase();
  const probeLat = probe.lat;
  const probeLng = probe.lng;
  const quoteLat = quote.lat;
  const quoteLng = quote.lng;
  const place = samePostal
    ? 0
    : probeLat != null && probeLng != null && quoteLat != null && quoteLng != null
      ? miles({ lat: probeLat, lng: probeLng }, { lat: quoteLat, lng: quoteLng })
      : 25;
  return size + place;
}

export function nearestSimilarQuotes(probe: DraftProbe, quotes: MemoryQuote[], limit = 3): MemoryQuote[] {
  return [...quotes].sort((left, right) => score(probe, left) - score(probe, right) || left.id.localeCompare(right.id)).slice(0, limit);
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function draftFromSimilarQuotes(quotes: MemoryQuote[]): MemoryLine[] {
  const nearest = quotes[0];
  if (!nearest) return [];
  return nearest.lines.map((line) => {
    const prices = quotes.flatMap((quote) => quote.lines.filter((item) => item.name === line.name).map((item) => item.price));
    return { ...line, price: median(prices.length ? prices : [line.price]) };
  });
}
