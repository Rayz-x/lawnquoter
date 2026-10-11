"use server";

import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type OfficeHit = {
  id: string;
  kind: "account" | "property" | "quote";
  label: string;
  hint: string;
  href: string;
};

function pattern(raw: string) {
  const safe = raw.trim().slice(0, 80).replace(/[%_\\,().]/g, " ").replace(/\s+/g, " ").trim();
  return { safe, like: `%${safe}%` };
}

export async function searchOffice(raw: string): Promise<OfficeHit[]> {
  const session = await requireOrg();
  const { safe, like } = pattern(raw);
  if (safe.length < 2) return [];
  const supabase = await createClient();
  const number = /^\d+$/.test(safe) ? Number(safe) : null;
  const quoteFilter =
    number == null
      ? supabase.from("quotes").select("id, number, title, accounts(name)").eq("org_id", session.orgId).ilike("title", like).limit(6)
      : supabase
          .from("quotes")
          .select("id, number, title, accounts(name)")
          .eq("org_id", session.orgId)
          .or(`title.ilike.${like},number.eq.${number}`)
          .limit(6);

  const [accounts, properties, quotes] = await Promise.all([
    supabase.from("accounts").select("id, name, billing_city").eq("org_id", session.orgId).ilike("name", like).limit(6),
    supabase
      .from("properties")
      .select("id, address_line1, city")
      .eq("org_id", session.orgId)
      .or(`address_line1.ilike.${like},formatted_address.ilike.${like}`)
      .limit(6),
    quoteFilter,
  ]);

  const hits: OfficeHit[] = [];
  for (const row of accounts.data ?? []) {
    hits.push({
      id: row.id,
      kind: "account",
      label: row.name,
      hint: row.billing_city ? `Account · ${row.billing_city}` : "Account",
      href: `/accounts/${row.id}`,
    });
  }
  for (const row of properties.data ?? []) {
    hits.push({
      id: row.id,
      kind: "property",
      label: row.address_line1,
      hint: row.city ? `Property · ${row.city}` : "Property",
      href: `/properties/${row.id}`,
    });
  }
  for (const row of quotes.data ?? []) {
    const account = row.accounts?.name;
    hits.push({
      id: row.id,
      kind: "quote",
      label: `#${row.number} ${row.title}`,
      hint: account ? `Quote · ${account}` : "Quote",
      href: `/quotes/${row.id}`,
    });
  }
  return hits;
}
