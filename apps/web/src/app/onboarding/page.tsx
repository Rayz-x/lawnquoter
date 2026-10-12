import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { OnboardingWizard } from "./onboarding-form";
import { resumeOnboarding, type WizardStep } from "./wizard";

export const metadata: Metadata = { title: "Set up your company" };

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  let step: WizardStep = "company";
  if (session.orgId) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("orgs").select("settings").eq("id", session.orgId).maybeSingle();
    if (error || !data) {
      step = "branding";
    } else {
      const resume = resumeOnboarding({ hasOrg: true, settings: data.settings });
      if (resume === "done") redirect("/dashboard");
      step = resume;
    }
  }
  return (
    <main className="flex flex-1 items-center justify-center p-6 [justify-content:safe_center] [padding-block-start:max(1.5rem,env(safe-area-inset-top,0px))] [padding-block-end:max(1.5rem,env(safe-area-inset-bottom,0px))]">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <Image
            src="/brand/lq-lockup-light.svg"
            alt="LawnQuoter"
            width={162}
            height={32}
            unoptimized
            className="h-8 w-auto dark:hidden"
          />
          <Image
            src="/brand/lq-lockup-dark.svg"
            alt=""
            width={162}
            height={32}
            unoptimized
            aria-hidden
            className="hidden h-8 w-auto dark:block"
          />
          <CardTitle className="font-heading text-xl font-semibold tracking-tight">Set up your company</CardTitle>
          <CardDescription>Company, brand color, starter services, a teammate, and the ZIPs you serve.</CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingWizard initialStep={step} />
        </CardContent>
      </Card>
    </main>
  );
}
