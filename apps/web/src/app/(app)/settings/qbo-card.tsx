import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QBO_NOT_CONNECTED, qboConfigured } from "@/lib/billing/qbo";

export function QboCard() {
  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>QuickBooks Online</CardTitle>
        <CardDescription>Two-way sync for customers, invoices, and payments. Sites map to sub-customers.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{qboConfigured() ? "QuickBooks keys are set." : QBO_NOT_CONNECTED}</p>
        <Link href="/settings/quickbooks" className="text-sm underline">
          Sync log and conflicts
        </Link>
      </CardContent>
    </Card>
  );
}
