import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOrg } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Dashboard" };

const TILES = [
  { title: "New leads", description: "Awaiting first response", value: "0" },
  { title: "Quotes out", description: "Sent, not yet decided", value: "0" },
  { title: "Won this month", description: "Accepted quote value", value: "$0" },
  { title: "Speed to lead", description: "Median first response", value: "—" },
];

export default async function DashboardPage() {
  await requireOrg();
  return (
    <>
      <PageHeader title="Dashboard" description="What needs attention today" />
      <div className="page-body">
        <div className="tiles">
          {TILES.map((t) => (
            <Card key={t.title}>
              <CardHeader>
                <CardDescription>{t.title}</CardDescription>
                <CardTitle className="font-heading text-3xl font-bold tabular-nums">{t.value}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
