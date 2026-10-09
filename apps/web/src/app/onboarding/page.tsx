import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your company" };

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.orgId) redirect("/dashboard");
  return (
    <main className="flex flex-1 items-center justify-center p-6 [justify-content:safe_center] [padding-block-start:max(1.5rem,env(safe-area-inset-top,0px))] [padding-block-end:max(1.5rem,env(safe-area-inset-bottom,0px))]">
      <Card className="w-full max-w-md">
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
          <CardDescription>
            This creates your workspace. You can invite your team and configure services and pricing next.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingForm />
        </CardContent>
      </Card>
    </main>
  );
}
