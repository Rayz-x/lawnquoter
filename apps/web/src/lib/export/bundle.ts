export type Cell = string | number | null;
export type Row = Record<string, Cell>;

export const EXPORT_COLUMNS = {
  accounts: ["id", "name", "type", "status", "email", "phone", "parent_account_id"],
  properties: ["id", "account_id", "name", "formatted_address", "city", "region", "postal_code", "lot_sqft"],
  quotes: ["id", "account_id", "number", "title", "status"],
  invoices: ["id", "account_id", "number_label", "status", "total_cents", "due_on"],
} as const;

export type ExportTables = {
  accounts: Row[];
  properties: Row[];
  quotes: Row[];
  invoices: Row[];
};

function csvCell(value: Cell): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function tableCsv(columns: readonly string[], rows: Row[]): string {
  const lines = [columns.map((column) => csvCell(column)).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column] ?? null)).join(","));
  return `${lines.join("\n")}\n`;
}

export function exportJson(tables: ExportTables): string {
  return `${JSON.stringify(tables, null, 2)}\n`;
}

export function invoicePdfLines(tables: ExportTables): string[] {
  const lines = ["LawnQuoter invoices"];
  for (const invoice of tables.invoices.slice(0, 40)) {
    lines.push(`${invoice.number_label ?? ""} — ${invoice.status ?? ""} — ${invoice.total_cents ?? 0} cents`.trim());
  }
  return lines;
}

export function exportPdfLines(tables: ExportTables): string[] {
  const lines = [
    "LawnQuoter export",
    `Accounts: ${tables.accounts.length}`,
    `Properties: ${tables.properties.length}`,
    `Quotes: ${tables.quotes.length}`,
    `Invoices: ${tables.invoices.length}`,
  ];
  for (const quote of tables.quotes.slice(0, 40)) {
    lines.push(`Q-${quote.number ?? ""} ${quote.title ?? ""} — ${quote.status ?? ""}`.trim());
  }
  return lines;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bytesOf(values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function u16(value: number): number[] {
  return [value & 255, (value >> 8) & 255];
}

function u32(value: number): number[] {
  return [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >> 24) & 255];
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function storedZip(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    if (!file.name || file.name.includes("/") || file.name.includes("\\")) throw new Error("Export file name is invalid.");
    const name = new TextEncoder().encode(file.name);
    const crc = crc32(file.bytes);
    const size = file.bytes.length;
    const local = concat([
      bytesOf([
        ...u32(0x04034b50),
        ...u16(20),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(crc),
        ...u32(size),
        ...u32(size),
        ...u16(name.length),
        ...u16(0),
      ]),
      name,
      file.bytes,
    ]);
    locals.push(local);
    central.push(
      concat([
        bytesOf([
          ...u32(0x02014b50),
          ...u16(20),
          ...u16(20),
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u32(crc),
          ...u32(size),
          ...u32(size),
          ...u16(name.length),
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u32(0),
          ...u32(offset),
          ...name,
        ]),
      ]),
    );
    offset += local.length;
  }
  const directory = concat(central);
  const end = bytesOf([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(files.length),
    ...u16(files.length),
    ...u32(directory.length),
    ...u32(offset),
    ...u16(0),
  ]);
  return concat([...locals, directory, end]);
}
