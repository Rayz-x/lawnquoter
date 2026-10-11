import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * In-memory PostgREST stand-in whose columns and lost-field check come from
 * the L01 migration, so adapter tests fail on invented columns.
 */
const MIGRATION_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../supabase/migrations/20261010204800_lead_intake_schema.sql",
);

type Row = Record<string, unknown>;
type DbError = { message: string; code: string };
type QueryResult = { data: unknown; error: DbError | null };

const migrationSql = readFileSync(MIGRATION_PATH, "utf8");

function columnsOf(table: "lead_requests" | "lead_activities"): string[] {
  const match = migrationSql.match(new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`));
  if (!match?.[1]) throw new Error(`Could not parse columns for ${table}`);
  const columns: string[] = [];
  for (const line of match[1].split("\n")) {
    if (!line.startsWith("  ") || line.startsWith("   ")) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith("constraint ")) continue;
    const name = trimmed.match(/^([a-z_][a-z0-9_]*)\s+/)?.[1];
    if (name) columns.push(name);
  }
  return columns;
}

const LEAD_REQUEST_COLUMNS = new Set(columnsOf("lead_requests"));
const LEAD_ACTIVITY_COLUMNS = new Set(columnsOf("lead_activities"));

function undefinedColumn(table: string, column: string): DbError {
  return {
    code: "42703",
    message: `column "${column}" of relation "${table}" does not exist`,
  };
}

function lostFieldsHold(row: Row): boolean {
  const lost = row.status === "lost";
  const reason = row.lost_reason ?? null;
  const note = row.lost_note ?? null;
  if (!lost) return reason === null && note === null;
  if (reason === null) return false;
  if (reason === "other" && note === null) return false;
  return true;
}

function selectItems(columns: string): string[] {
  const items: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of columns) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      if (current.trim()) items.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

type SelectPlan =
  | { ok: true; columns: string[]; embed: { fk: string } | null }
  | { ok: false; error: DbError };

function planSelect(table: string, allowed: Set<string>, columns: string): SelectPlan {
  const plan: { columns: string[]; embed: { fk: string } | null } = { columns: [], embed: null };
  for (const item of selectItems(columns)) {
    const embed = item.match(/^([a-z_]+):([a-z_]+)\(([a-z0-9_,\s]+)\)$/i);
    if (embed) {
      const fk = embed[2] ?? "";
      if (!allowed.has(fk)) return { ok: false, error: undefinedColumn(table, fk) };
      plan.embed = { fk };
      continue;
    }
    if (!allowed.has(item)) return { ok: false, error: undefinedColumn(table, item) };
    plan.columns.push(item);
  }
  return { ok: true, ...plan };
}

function unknownWriteColumn(table: string, allowed: Set<string>, values: Row): DbError | null {
  for (const column of Object.keys(values)) {
    if (!allowed.has(column)) return undefinedColumn(table, column);
  }
  return null;
}

export type LeadSchemaClient = {
  leadRequests: Row[];
  leadActivities: Row[];
  profiles: Map<string, { email: string | null }>;
  from: (table: string) => LeadSchemaQuery;
};

type LeadSchemaQuery = {
  select: (columns: string) => LeadSchemaQuery;
  update: (values: Row) => LeadSchemaQuery;
  insert: (values: Row) => LeadSchemaQuery;
  eq: (column: string, value: string) => LeadSchemaQuery;
  maybeSingle: () => Promise<QueryResult>;
  single: () => Promise<QueryResult>;
  then: Promise<QueryResult>["then"];
};

export function createLeadSchemaClient(): LeadSchemaClient {
  const leadRequests: Row[] = [];
  const leadActivities: Row[] = [];
  const profiles = new Map<string, { email: string | null }>();
  let activitySeq = 0;

  function rowsFor(table: string): { rows: Row[]; allowed: Set<string> } | null {
    if (table === "lead_requests") return { rows: leadRequests, allowed: LEAD_REQUEST_COLUMNS };
    if (table === "lead_activities") return { rows: leadActivities, allowed: LEAD_ACTIVITY_COLUMNS };
    return null;
  }

  function project(table: string, row: Row, plan: Extract<SelectPlan, { ok: true }>): Row {
    const projected: Row = {};
    for (const column of plan.columns) projected[column] = row[column] ?? null;
    if (plan.embed && table === "lead_requests") {
      const assignee = row[plan.embed.fk];
      projected.profiles = assignee == null ? null : (profiles.get(String(assignee)) ?? null);
    }
    return projected;
  }

  function execute(
    table: string,
    op: "select" | "update" | "insert",
    values: Row | null,
    filters: { column: string; value: string }[],
    columns: string,
    mode: "many" | "maybe" | "single",
  ): QueryResult {
    const target = rowsFor(table);
    if (!target) {
      return {
        data: null,
        error: { code: "42P01", message: `relation "${table}" does not exist` },
      };
    }

    if (op === "select" && !columns) {
      return { data: null, error: { code: "42703", message: "select list is empty" } };
    }

    const plan = columns ? planSelect(table, target.allowed, columns) : { ok: true as const, columns: [], embed: null };
    if (!plan.ok) return { data: null, error: plan.error };

    const matches = (row: Row) => filters.every((filter) => String(row[filter.column]) === filter.value);

    if (op === "update") {
      const patch = values ?? {};
      const unknown = unknownWriteColumn(table, target.allowed, patch);
      if (unknown) return { data: null, error: unknown };
      for (const row of target.rows) {
        if (!matches(row)) continue;
        const next = { ...row, ...patch };
        if (table === "lead_requests") {
          if (!lostFieldsHold(next)) {
            return {
              data: null,
              error: {
                code: "23514",
                message: 'new row for relation "lead_requests" violates check constraint "lead_requests_lost_fields_chk"',
              },
            };
          }
        }
        Object.assign(row, next);
      }
      return { data: null, error: null };
    }

    if (op === "insert") {
      const inserted = { ...(values ?? {}) };
      const unknown = unknownWriteColumn(table, target.allowed, inserted);
      if (unknown) return { data: null, error: unknown };
      if (table === "lead_activities") {
        if (typeof inserted.summary !== "string" || inserted.summary.trim().length === 0) {
          return {
            data: null,
            error: {
              code: "23502",
              message: 'null value in column "summary" of relation "lead_activities" violates not-null constraint',
            },
          };
        }
        if (inserted.meta == null) inserted.meta = {};
      }
      if (inserted.id == null) {
        activitySeq += 1;
        inserted.id = `act-${activitySeq}`;
      }
      target.rows.push(inserted);
      const projected = plan.columns.length > 0 ? project(table, inserted, plan) : inserted;
      if (mode === "single" || mode === "maybe") return { data: projected, error: null };
      return { data: [projected], error: null };
    }

    const found = target.rows.filter(matches).map((row) => project(table, row, plan));
    if (mode === "maybe" || mode === "single") return { data: found[0] ?? null, error: null };
    return { data: found, error: null };
  }

  function query(
    table: string,
    op: "select" | "update" | "insert",
    values: Row | null,
    filters: { column: string; value: string }[],
    columns: string,
  ): LeadSchemaQuery {
    const run = (mode: "many" | "maybe" | "single") => Promise.resolve(execute(table, op, values, filters, columns, mode));
    const builder: LeadSchemaQuery = {
      select(nextColumns) {
        return query(table, op === "insert" ? "insert" : "select", values, filters, nextColumns);
      },
      update(nextValues) {
        return query(table, "update", nextValues, filters, columns);
      },
      insert(nextValues) {
        return query(table, "insert", nextValues, filters, columns);
      },
      eq(column, value) {
        return query(table, op, values, [...filters, { column, value }], columns);
      },
      maybeSingle() {
        return run("maybe");
      },
      single() {
        return run("single");
      },
      then(onfulfilled, onrejected) {
        return run("many").then(onfulfilled, onrejected);
      },
    };
    return builder;
  }

  return {
    leadRequests,
    leadActivities,
    profiles,
    from(table) {
      return query(table, "select", null, [], "");
    },
  };
}
