import type { Metadata } from "next";
import { requireOrg } from "@/lib/auth/session";
import { readTwilioConfig, TWILIO_NOT_CONNECTED } from "@/lib/messaging/sms";
import { createClient } from "@/lib/supabase/server";
import { DayList } from "./day-list";

export const metadata: Metadata = { title: "Today" };

export default async function CrewTodayPage() {
  const session = await requireOrg();
  const supabase = await createClient();
  const { data: org } = await supabase.from("orgs").select("timezone").eq("id", session.orgId).single();
  const textsConnected = readTwilioConfig(process.env) !== null;
  return <DayList timeZone={org?.timezone ?? "UTC"} userId={session.userId} orgId={session.orgId} textsConnected={textsConnected} textNotice={textsConnected ? null : TWILIO_NOT_CONNECTED} />;
}
