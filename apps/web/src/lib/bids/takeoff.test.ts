import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseTakeoff } from "./takeoff";

function zipStored(name: string, body: string): Buffer {
  const data = Buffer.from(body);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(nameBuf.length, 26);
  const compressed = deflateRawSync(data);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  return Buffer.concat([local, nameBuf, compressed]);
}

describe("takeoff import", () => {
  it("turns GeoJSON polygons into square-foot lines", () => {
    const parsed = parseTakeoff(
      "site.geojson",
      Buffer.from(
        JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { name: "Front lawn" },
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [-89.65, 39.8],
                    [-89.65, 39.8003],
                    [-89.6496, 39.8003],
                    [-89.6496, 39.8],
                    [-89.65, 39.8],
                  ],
                ],
              },
            },
          ],
        }),
      ),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.kind).toBe("geojson");
    expect(parsed.lines[0]?.name).toBe("Front lawn");
    expect(parsed.lines[0]?.unit).toBe("sq ft");
    expect(parsed.areaSqft).toBeGreaterThan(1000);
  });

  it("reads a spreadsheet of spec lines, including a zipped worksheet", () => {
    const csv = parseTakeoff("spec.csv", Buffer.from("name,qty,unit\nMulch,40,yard\n"));
    expect(csv).toMatchObject({ ok: true, kind: "xls", lines: [{ name: "Mulch", qty: 40, unit: "yard" }] });

    const sheet = `<worksheet><sheetData><row><c t="inlineStr"><is><t>name</t></is></c><c t="inlineStr"><is><t>qty</t></is></c></row><row><c t="inlineStr"><is><t>Edging</t></is></c><c><v>12</v></c></row></sheetData></worksheet>`;
    const bytes = Buffer.concat([
      zipStored("xl/worksheets/sheet1.xml", sheet),
      zipStored("xl/sharedStrings.xml", ""),
    ]);
    const xlsx = parseTakeoff("takeoff.xlsx", bytes);
    expect(xlsx).toMatchObject({ ok: true, lines: [{ name: "Edging", qty: 12, unit: "each" }] });
  });
});
