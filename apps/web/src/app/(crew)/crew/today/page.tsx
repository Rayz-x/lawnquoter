import type { Metadata } from "next";
import { requireOrg } from "@/lib/auth/session";
import { orgToday } from "@/lib/scheduling/office-date";
import { createClient } from "@/lib/supabase/server";
import { DayList } from "./day-list";

export const metadata: Metadata = { title: "Today" };

export default async function CrewTodayPage() {
  const session = await requireOrg();
  const supabase = await createClient();
  const { data: org } = await supabase.from("orgs").select("timezone").eq("id", session.orgId).single();
  return <DayList date={org ? orgToday(org.timezone) : null} />;
}
