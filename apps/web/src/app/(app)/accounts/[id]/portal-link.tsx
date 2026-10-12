import { Button } from "@/components/ui/button";
import { FieldHint } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/server";
import { createPortalLink } from "../portal-actions";

export async function PortalLink({
  accountId,
  email,
  canEdit,
}: {
  accountId: string;
  email: string | null;
  canEdit: boolean;
}) {
  const supabase = await createClient();
  const { data: links } = canEdit
    ? await supabase
        .from("portal_links")
        .select("token, email, expires_at")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(1)
    : { data: null };
  const latest = links?.[0];
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return (
    <section className="rounded-lg border p-4">
      <h2 className="font-heading text-lg">Customer portal</h2>
      <p className="text-sm text-muted-foreground">
        Quotes, payments, schedule, photos, and service requests for this account and its sites. Mail sends when email is configured. This link always works.
      </p>
      {latest ? (
        <p className="mt-2 break-all text-sm">
          <a className="underline" href={`${origin}/portal/${latest.token}`}>
            {origin}/portal/{latest.token}
          </a>
          <span className="text-muted-foreground"> · {latest.email} · until {latest.expires_at.slice(0, 10)}</span>
        </p>
      ) : null}
      {canEdit ? (
        <form action={createPortalLink} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <input type="hidden" name="account_id" value={accountId} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="portal-email" className="text-sm">Email</label>
            <Input id="portal-email" name="email" type="email" required aria-describedby="portal-email-hint" defaultValue={email ?? ""} placeholder="customer@example.com" className="w-full" />
            <FieldHint id="portal-email-hint">The address that receives this customer's portal link.</FieldHint>
          </div>
          <Button type="submit">Create portal link</Button>
        </form>
      ) : null}
    </section>
  );
}
