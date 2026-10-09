import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { NewQuoteForm } from "./new-quote-form";

export const metadata: Metadata = { title: "New quote" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const session = await requireOrg();
  const { account } = await searchParams;
  const supabase = await createClient();
  const { data: accounts } = await supabase.from("accounts").select("id, name").eq("org_id", session.orgId).order("name");
  const { data: properties } = await supabase
    .from("properties")
    .select("id, formatted_address, account_id")
    .eq("org_id", session.orgId)
    .order("formatted_address");

  return (
    <>
      <PageHeader title="New quote" description="Pick the account and optional property" />
      <div className="p-4">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Customer</CardTitle>
            <CardDescription>The quote will open in the builder so you can add priced lines.</CardDescription>
          </CardHeader>
          <CardContent>
            <NewQuoteForm accounts={accounts ?? []} properties={properties ?? []} defaultAccountId={account} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
