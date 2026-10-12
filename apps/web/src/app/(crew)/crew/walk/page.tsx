import type { Metadata } from "next";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { WalkForm } from "./walk-form";

export const metadata: Metadata = { title: "Site walk" };

export default async function SiteWalkPage() {
  const session = await requireOrg();
  const supabase = await createClient();
  const [{ data: packages }, { data: notes }] = await Promise.all([
    supabase.from("bid_packages").select("id, title").eq("org_id", session.orgId).order("walk_on").limit(100),
    supabase.from("site_walk_notes").select("id, package_id, body, lat, lng").eq("org_id", session.orgId).order("created_at", { ascending: false }).limit(200),
  ]);

  return (
    <section className="flex flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-8">
      <h1 className="text-2xl font-bold">Site walk</h1>
      <p className="text-[15px] text-muted-foreground">Pin a note on the property. Dictate if the keyboard is in the way.</p>
      {(packages ?? []).length === 0 ? (
        <p className="text-[15px]">No bid packages are ready to walk.</p>
      ) : (
        <WalkForm packages={packages ?? []} notes={notes ?? []} />
      )}
    </section>
  );
}
