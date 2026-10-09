import type { Metadata } from "next";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNext } from "@/lib/auth/safe-next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center p-6 [justify-content:safe_center] [padding-block-start:max(1.5rem,env(safe-area-inset-top,0px))] [padding-block-end:max(1.5rem,env(safe-area-inset-bottom,0px))]">
      <Card className="w-full max-w-sm">
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
          <CardTitle className="font-heading text-xl font-semibold tracking-tight">Sign in</CardTitle>
          <CardDescription>Use your email and password, or request a one-time sign-in link.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={safeNext(next)} initialError={error ?? null} />
        </CardContent>
      </Card>
    </main>
  );
}
