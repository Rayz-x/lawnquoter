import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Lawnquoter</CardTitle>
          <CardDescription>Use your email and password, or request a one-time sign-in link.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={next ?? "/dashboard"} initialError={error ?? null} />
        </CardContent>
      </Card>
    </main>
  );
}
