import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AccountForm } from "../account-form";

export const metadata: Metadata = { title: "New account" };

export default async function NewAccountPage() {
  const session = await requireOrg();
  const supabase = await createClient();
  const { data: parents } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("org_id", session.orgId)
    .is("parent_account_id", null)
    .eq("type", "commercial")
    .order("name");
  return (
    <>
      <PageHeader title="New account" />
      <div className="p-4">
        <Card className="max-w-2xl">
          <CardContent className="pt-6">
            <AccountForm parents={parents ?? []} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
