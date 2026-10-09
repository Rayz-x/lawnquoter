"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { Tables } from "@/lib/supabase/types";
import { createAccount, updateAccount } from "./actions";

type ParentOption = { id: string; name: string };

export function AccountForm({
  account,
  parents,
}: {
  account?: Tables<"accounts">;
  parents: ParentOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      if (account) {
        const r = await updateAccount(account.id, fd);
        if (r.ok) toast.success("Account saved");
        else toast.error(r.error);
      } else {
        const r = await createAccount(fd);
        if (r.ok) {
          toast.success("Account created");
          router.push(`/accounts/${r.data.id}`);
        } else toast.error(r.error);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="type">Type</FieldLabel>
            <select
              id="type"
              name="type"
              defaultValue={account?.type ?? "residential"}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="status">Status</FieldLabel>
            <select
              id="status"
              name="status"
              defaultValue={account?.status ?? "lead"}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="lead">Lead</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="name">Account name</FieldLabel>
          <Input id="name" name="name" required defaultValue={account?.name ?? ""} />
          <FieldDescription>Homeowner name, or the property manager / HOA / business.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="company_name">Company (optional)</FieldLabel>
          <Input id="company_name" name="company_name" defaultValue={account?.company_name ?? ""} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="phone">Phone</FieldLabel>
            <Input id="phone" name="phone" defaultValue={account?.phone ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" name="email" type="email" defaultValue={account?.email ?? ""} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="parent_account_id">Parent account</FieldLabel>
          <select
            id="parent_account_id"
            name="parent_account_id"
            defaultValue={account?.parent_account_id ?? ""}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">None (top-level)</option>
            {parents
              .filter((p) => p.id !== account?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <FieldDescription>For multi-site customers: HOA phases, property manager portfolios, franchise locations.</FieldDescription>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="billing_email">Billing email</FieldLabel>
            <Input id="billing_email" name="billing_email" type="email" defaultValue={account?.billing_email ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="net_terms_days">Payment terms (net days)</FieldLabel>
            <Input id="net_terms_days" name="net_terms_days" type="number" min={0} max={120} defaultValue={account?.net_terms_days ?? 0} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="po_required" defaultChecked={account?.po_required ?? false} /> PO number required
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="tax_exempt" defaultChecked={account?.tax_exempt ?? false} /> Tax exempt
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="consolidated_invoicing" defaultChecked={account?.consolidated_invoicing ?? false} /> Consolidated invoice
          </label>
        </div>
        <Field>
          <FieldLabel htmlFor="lead_source">Lead source</FieldLabel>
          <Input id="lead_source" name="lead_source" placeholder="Google, referral, door hanger…" defaultValue={account?.lead_source ?? ""} />
        </Field>
        <Field>
          <FieldLabel htmlFor="notes">Notes</FieldLabel>
          <Textarea id="notes" name="notes" rows={3} defaultValue={account?.notes ?? ""} />
        </Field>
      </FieldGroup>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {account ? "Save changes" : "Create account"}
        </Button>
      </div>
    </form>
  );
}
