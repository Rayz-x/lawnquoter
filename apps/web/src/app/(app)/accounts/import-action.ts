"use server";

import { revalidatePath } from "next/cache";
import { SALES_ROLES, hasRole } from "@lawnquoter/shared";
import { fail, type ActionResult } from "@/lib/actions/result";
import { parseCustomerPropertyCsv, planCustomerImport, type CsvIssue } from "@/lib/accounts/csv-import";
import { loadAccountDirectory } from "@/lib/accounts/load-duplicates";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const ROW_CAP = 200;

export type CustomerImportResult = {
  created: { id: string; name: string }[];
  skipped: { line: number; name: string; detail: string }[];
  issues: CsvIssue[];
};

export async function importCustomersCsv(csv: string): Promise<ActionResult<CustomerImportResult>> {
  const session = await requireOrg();
  if (!hasRole(session.orgRole, SALES_ROLES)) return fail("You don't have permission to edit customers.");
  const parsed = parseCustomerPropertyCsv(csv);
  if (parsed.rows.length > ROW_CAP) return fail(`Import up to ${ROW_CAP} customers at a time.`);
  const supabase = await createClient();
  let directory;
  try {
    directory = await loadAccountDirectory(supabase, session.orgId);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not load accounts");
  }
  const plan = planCustomerImport(parsed.rows, directory);
  const created: CustomerImportResult["created"] = [];
  const skipped = plan.flatMap((item) =>
    item.kind === "skip" ? [{ line: item.row.line, name: item.row.name, detail: item.duplicate.detail }] : [],
  );
  const issues = [...parsed.issues];

  for (const item of plan) {
    if (item.kind !== "create") continue;
    const row = item.row;
    const { data, error } = await supabase
      .from("accounts")
      .insert({
        org_id: session.orgId,
        created_by: session.userId,
        name: row.name,
        type: row.type,
        status: "lead",
        phone: row.phone,
        email: row.email,
        billing_address_line1: row.addressLine1,
        billing_city: row.city,
        billing_region: row.region,
        billing_postal_code: row.postalCode,
      })
      .select("id")
      .single();
    if (error || !data) {
      issues.push({ line: row.line, message: error?.message ?? "Could not create the account." });
      continue;
    }
    if (row.addressLine1 && row.city && row.region && row.postalCode) {
      const property = await supabase.from("properties").insert({
        org_id: session.orgId,
        account_id: data.id,
        address_line1: row.addressLine1,
        city: row.city,
        region: row.region,
        postal_code: row.postalCode,
      });
      if (property.error) issues.push({ line: row.line, message: property.error.message });
    }
    await supabase.from("activities").insert({
      org_id: session.orgId,
      account_id: data.id,
      kind: "account.created",
      summary: "Account imported from CSV",
      actor_id: session.userId,
    });
    created.push({ id: data.id, name: row.name });
  }

  revalidatePath("/accounts");
  return { ok: true, data: { created, skipped, issues } };
}
