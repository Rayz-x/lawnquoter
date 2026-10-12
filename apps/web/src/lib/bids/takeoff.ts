import { inflateRawSync } from "node:zlib";
import area from "@turf/area";

export type TakeoffLine = { name: string; qty: number; unit: string };

export type TakeoffParse =
  | { ok: true; kind: "geojson" | "xls"; featureCount: number; areaSqft: number; lines: TakeoffLine[] }
  | { ok: false; error: string };

const SQFT_PER_SQM = 10.76391041671;

export function parseTakeoff(filename: string, bytes: Uint8Array): TakeoffParse {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzip(Buffer.from(bytes));
    const sheet = files.get("xl/worksheets/sheet1.xml");
    if (!sheet) return { ok: false, error: "That workbook has no first sheet." };
    return csvTakeoff(filename, sheetToCsv(sheet, files.get("xl/sharedStrings.xml") ?? ""));
  }
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return geojsonTakeoff(trimmed);
  if (trimmed.includes("<Workbook") || trimmed.includes("<worksheet")) {
    return csvTakeoff(filename, sheetToCsv(trimmed, ""));
  }
  return csvTakeoff(filename, trimmed);
}

function geojsonTakeoff(text: string): TakeoffParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid GeoJSON." };
  }
  const features = featuresOf(parsed);
  if (!features) return { ok: false, error: "GeoJSON needs a Feature or FeatureCollection." };
  const lines: TakeoffLine[] = [];
  let areaSqft = 0;
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;
    const sqft = Math.round(area(geometry as Parameters<typeof area>[0]) * SQFT_PER_SQM);
    areaSqft += sqft;
    const name = typeof feature.properties?.name === "string" ? feature.properties.name : `Area ${lines.length + 1}`;
    lines.push({ name, qty: sqft, unit: "sq ft" });
  }
  if (lines.length === 0) return { ok: false, error: "No polygon areas were found in that GeoJSON." };
  return { ok: true, kind: "geojson", featureCount: lines.length, areaSqft, lines };
}

function csvTakeoff(filename: string, text: string): TakeoffParse {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.split(/,|\t/).map((cell) => cell.trim().replace(/^"|"$/g, "")))
    .filter((row) => row.some((cell) => cell.length > 0));
  if (rows.length < 2) return { ok: false, error: "The spreadsheet needs a header and at least one row." };
  const header = rows[0]?.map((cell) => cell.toLowerCase()) ?? [];
  const nameAt = header.findIndex((cell) => cell === "name" || cell === "item" || cell === "description");
  const qtyAt = header.findIndex((cell) => cell === "qty" || cell === "quantity" || cell === "sqft" || cell === "area");
  const unitAt = header.findIndex((cell) => cell === "unit");
  if (nameAt < 0) return { ok: false, error: "The spreadsheet needs a name column." };
  const lines: TakeoffLine[] = [];
  for (const row of rows.slice(1)) {
    const name = row[nameAt]?.trim();
    if (!name) continue;
    const qty = qtyAt >= 0 ? Number(row[qtyAt]) : 1;
    lines.push({ name, qty: Number.isFinite(qty) ? qty : 1, unit: (unitAt >= 0 ? row[unitAt] : "") || "each" });
  }
  if (lines.length === 0) return { ok: false, error: "No takeoff rows were found." };
  return {
    ok: true,
    kind: "xls",
    featureCount: lines.length,
    areaSqft: lines.reduce((sum, line) => sum + (line.unit === "sq ft" ? line.qty : 0), 0),
    lines,
  };
}

function featuresOf(value: unknown): { geometry?: { type: string }; properties?: { name?: string } }[] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { type?: string; features?: unknown; geometry?: { type: string } };
  if (record.type === "FeatureCollection" && Array.isArray(record.features)) return record.features as never;
  if (record.type === "Feature") return [record as never];
  return null;
}

function unzip(buffer: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const start = offset + 30 + nameLen + extraLen;
    const compressed = buffer.subarray(start, start + size);
    const raw = method === 8 ? inflateRawSync(compressed) : method === 0 ? compressed : null;
    if (raw && name) files.set(name, raw.toString("utf8"));
    offset = start + size;
  }
  return files;
}

function sheetToCsv(sheetXml: string, sharedXml: string): string {
  const shared = [...sharedXml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((match) => match[1] ?? "");
  const rows = [...sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells = [...row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map((cell) => {
      const type = /t="([^"]+)"/.exec(cell[1])?.[1];
      const value = /<v>([^<]*)<\/v>/.exec(cell[2])?.[1] ?? /<t[^>]*>([^<]*)<\/t>/.exec(cell[2])?.[1] ?? "";
      return type === "s" ? shared[Number(value)] ?? "" : value;
    });
    return cells.join(",");
  });
  return rows.join("\n");
}
