import type { Metadata } from "next";
import { CrewDayMap } from "@/components/crew/crew-day-map";
import { requireOrg } from "@/lib/auth/session";
import { orgToday } from "@/lib/scheduling/office-date";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Map" };

export default async function CrewMapPage() {
  const session = await requireOrg();
  const supabase = await createClient();
  const { data: org } = await supabase.from("orgs").select("timezone").eq("id", session.orgId).single();
  const date = orgToday(org?.timezone ?? "UTC", new Date());
  return <CrewDayMap date={date} />;
}
