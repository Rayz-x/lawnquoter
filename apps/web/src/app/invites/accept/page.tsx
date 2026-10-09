import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNext } from "@/lib/auth/safe-next";
import { AcceptInviteButton } from "./accept-invite-button";

export const metadata: Metadata = { title: "Accept invite" };

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const nextPath = safeNext(token ? `/invites/accept?token=${token}` : null, "");
  const valid = nextPath.startsWith("/invites/accept?token=") && token;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-heading text-xl font-semibold tracking-tight">Join a workspace</CardTitle>
          <CardDescription>Accepting adds you as a member. Nothing is granted until you do.</CardDescription>
        </CardHeader>
        <CardContent>
          {valid ? (
            <AcceptInviteButton token={token} />
          ) : (
            <p className="text-sm text-muted-foreground">This invite link is missing its token. Ask for a new invite.</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
