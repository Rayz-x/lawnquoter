import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AccountForm } from "../account-form";

export const metadata: Metadata = { title: "New account" };

export default async function NewAccountPage() {
  const session = await requireOrg();
  const supabase = await createClient();
  const { data: parents, error } = await supabase
    .from("accounts")
    .select("id, name")
    .eq("org_id", session.orgId)
    .is("parent_account_id", null)
    .eq("type", "commercial")
    .order("name");
  if (error) {
    return (
      <>
        <PageHeader title="New account" />
        <div className="page-body">
          <Alert variant="destructive">
            <AlertTitle>Could not load accounts</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader title="New account" />
      <div className="page-body">
        <Card className="max-w-2xl">
          <CardContent className="pt-6">
            <AccountForm parents={parents ?? []} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
