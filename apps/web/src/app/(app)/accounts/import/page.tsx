import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { requireOrg } from "@/lib/auth/session";
import { ImportCustomersForm } from "./import-form";

export const metadata: Metadata = { title: "Import customers" };

export default async function ImportCustomersPage() {
  await requireOrg();
  return (
    <>
      <PageHeader
        title="Import customers"
        description="Add customers and properties from a spreadsheet"
        actions={
          <Button variant="outline" render={<Link href="/accounts" />}>
            Accounts
          </Button>
        }
      />
      <div className="page-body">
        <ImportCustomersForm />
      </div>
    </>
  );
}
