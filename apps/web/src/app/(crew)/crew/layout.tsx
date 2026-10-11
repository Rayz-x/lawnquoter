import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { CrewShell } from "@/components/crew/shell";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  applicationName: "LawnQuoter Crew",
  manifest: "/crew/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Crew", statusBarStyle: "default" },
  icons: { apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1E5235",
};

export default async function CrewLayout({ children }: { children: ReactNode }) {
  const session = await requireOrg();
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", session.userId).single();
  const authorName = profile?.full_name?.trim() || session.email?.split("@")[0] || "Lead";
  return (
    <CrewShell userId={session.userId} orgId={session.orgId} authorName={authorName}>
      {children}
    </CrewShell>
  );
}
