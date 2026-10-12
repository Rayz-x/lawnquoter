import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { directoryFromRows, findAccountDuplicates, type AccountDuplicate, type DuplicateProbe } from "./duplicates";

const ACCOUNT_CAP = 2000;

export async function loadAccountDuplicates(
  supabase: SupabaseClient<Database>,
  orgId: string,
  probe: DuplicateProbe,
): Promise<AccountDuplicate[]> {
  const [{ data: accounts, error: accountError }, { data: contacts, error: contactError }, { data: properties, error: propertyError }] =
    await Promise.all([
      supabase
        .from("accounts")
        .select("id, name, phone, billing_address_line1, billing_city, billing_postal_code")
        .eq("org_id", orgId)
        .order("name")
        .limit(ACCOUNT_CAP),
      supabase.from("contacts").select("account_id, phone").eq("org_id", orgId).not("phone", "is", null).limit(ACCOUNT_CAP * 2),
      supabase
        .from("properties")
        .select("account_id, address_line1, city, postal_code")
        .eq("org_id", orgId)
        .limit(ACCOUNT_CAP * 2),
    ]);
  const message = accountError?.message ?? contactError?.message ?? propertyError?.message;
  if (message) throw new Error(message);
  return findAccountDuplicates(
    probe,
    directoryFromRows({
      accounts: accounts ?? [],
      contacts: contacts ?? [],
      properties: properties ?? [],
    }),
  );
}
