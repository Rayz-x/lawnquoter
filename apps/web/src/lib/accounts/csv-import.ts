import { findAccountDuplicates, type AccountDirectoryEntry, type AccountDuplicate } from "./duplicates";

export type CustomerCsvRow = {
  line: number;
  name: string;
  phone: string | null;
  email: string | null;
  type: "residential" | "commercial";
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
};

export type CsvIssue = { line: number; message: string };

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function cell(row: Record<string, string>, key: string): string {
  return (row[key] ?? "").trim();
}

export function parseCustomerPropertyCsv(csv: string): { rows: CustomerCsvRow[]; issues: CsvIssue[] } {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return { rows: [], issues: [{ line: 1, message: "CSV needs a name column." }] };
  const header = splitCsvLine(lines[0] ?? "").map((column) => column.toLowerCase());
  if (!header.includes("name")) return { rows: [], issues: [{ line: 1, message: "CSV needs a name column." }] };

  const rows: CustomerCsvRow[] = [];
  const issues: CsvIssue[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = index + 1;
    const values = splitCsvLine(lines[index] ?? "");
    const record: Record<string, string> = {};
    header.forEach((column, columnIndex) => {
      record[column] = values[columnIndex] ?? "";
    });
    const name = cell(record, "name");
    const email = cell(record, "email");
    const typeRaw = cell(record, "type").toLowerCase();
    const address = {
      addressLine1: cell(record, "address_line1"),
      city: cell(record, "city"),
      region: cell(record, "region"),
      postalCode: cell(record, "postal_code"),
    };
    const addressParts = [address.addressLine1, address.city, address.region, address.postalCode];
    const addressStarted = addressParts.some(Boolean);
    const addressComplete = addressParts.every(Boolean);
    let blocked = false;
    if (!name) {
      issues.push({ line, message: "Name is required." });
      blocked = true;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      issues.push({ line, message: "Enter a valid email." });
      blocked = true;
    }
    if (typeRaw && typeRaw !== "residential" && typeRaw !== "commercial") {
      issues.push({ line, message: "Type must be residential or commercial." });
      blocked = true;
    }
    if (addressStarted && !addressComplete) {
      issues.push({ line, message: "Address needs street, city, state, and ZIP, or leave all four blank." });
      blocked = true;
    }
    if (blocked) continue;
    rows.push({
      line,
      name,
      phone: cell(record, "phone") || null,
      email: email || null,
      type: typeRaw === "commercial" ? "commercial" : "residential",
      addressLine1: addressComplete ? address.addressLine1 : null,
      city: addressComplete ? address.city : null,
      region: addressComplete ? address.region : null,
      postalCode: addressComplete ? address.postalCode : null,
    });
  }
  return { rows, issues };
}

export type ImportPlanItem =
  | { kind: "create"; row: CustomerCsvRow }
  | { kind: "skip"; row: CustomerCsvRow; duplicate: AccountDuplicate };

export function planCustomerImport(rows: CustomerCsvRow[], directory: AccountDirectoryEntry[]): ImportPlanItem[] {
  const working = directory.map((entry) => ({
    ...entry,
    phones: [...entry.phones],
    addresses: [...entry.addresses],
  }));
  const plan: ImportPlanItem[] = [];
  for (const row of rows) {
    const matches = findAccountDuplicates(
      {
        phones: [row.phone],
        addresses: row.addressLine1
          ? [{ addressLine1: row.addressLine1, city: row.city, postalCode: row.postalCode }]
          : [],
      },
      working,
    );
    const duplicate = matches[0];
    if (duplicate) {
      plan.push({ kind: "skip", row, duplicate });
      continue;
    }
    plan.push({ kind: "create", row });
    working.push({
      accountId: `new-${row.line}`,
      accountName: row.name,
      phones: [row.phone],
      addresses: row.addressLine1
        ? [{ addressLine1: row.addressLine1, city: row.city, postalCode: row.postalCode }]
        : [],
    });
  }
  return plan;
}
