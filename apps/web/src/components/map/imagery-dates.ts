export type ImageryChoice = {
  id: string;
  label: string;
  /** Publish date stored on the property. Null is the live World Imagery mosaic. */
  date: string | null;
  release: number | null;
};

/** A short public list of Esri World Imagery Wayback releases, newest first. */
export const IMAGERY_CHOICES: ImageryChoice[] = [
  { id: "latest", label: "Latest", date: null, release: null },
  { id: "2024-06-06", label: "Jun 6, 2024", date: "2024-06-06", release: 12428 },
  { id: "2022-06-29", label: "Jun 29, 2022", date: "2022-06-29", release: 4905 },
  { id: "2020-10-14", label: "Oct 14, 2020", date: "2020-10-14", release: 119 },
  { id: "2014-02-20", label: "Feb 20, 2014", date: "2014-02-20", release: 10 },
];

/** Null is Latest. Any other string must be one of the Wayback publish dates. */
export function listedImageryDate(value: string | null): string | null | undefined {
  if (value === null) return null;
  return IMAGERY_CHOICES.some((choice) => choice.date === value) ? value : undefined;
}

export function imageryChoiceForDate(date: string | null | undefined): ImageryChoice {
  const day = date?.slice(0, 10) ?? "";
  return IMAGERY_CHOICES.find((choice) => choice.date === day) ?? IMAGERY_CHOICES[0]!;
}

export function waybackTileUrl(release: number): string {
  return `https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${release}/{z}/{y}/{x}`;
}
