"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChipGroup, InternalNote, SectionCard, ToggleRow, useSectionAutosave } from "@/components/entry";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { Tables } from "@/lib/supabase/types";
import {
  BILLING_DETAILS_LABEL,
  billingAddressDraft,
  billingEmailDraft,
  shouldOpenBillingDetails,
  type PropertyAddress,
} from "../billing-details";
import {
  updateAccountBilling,
  updateAccountNotes,
  updateAccountSales,
  type BillingDraft,
  type NotesDraft,
  type SalesDraft,
} from "../rail-actions";

export const LEAD_SOURCES = ["Google", "Referral", "Door hanger", "Yard sign", "Repeat", "Other"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function termsChoice(days: number): "0" | "15" | "30" | "custom" {
  if (days === 0) return "0";
  if (days === 15) return "15";
  if (days === 30) return "30";
  return "custom";
}

export function AccountRail({
  account,
  parents,
  ownerName,
  firstProperty = null,
}: {
  account: Tables<"accounts">;
  parents: { id: string; name: string }[];
  ownerName: string;
  firstProperty?: PropertyAddress | null;
}) {
  const [billingOpen, setBillingOpen] = useState(shouldOpenBillingDetails(account));
  return (
    <div className="flex flex-col gap-4">
      {billingOpen ? (
        <BillingCard account={account} parents={parents} firstProperty={firstProperty} />
      ) : (
        <Button type="button" variant="ghost" className="min-h-11 justify-start" onClick={() => setBillingOpen(true)}>
          {BILLING_DETAILS_LABEL}
        </Button>
      )}
      <SalesCard account={account} ownerName={ownerName} />
      <NotesCard account={account} />
    </div>
  );
}

function BillingCard({
  account,
  parents,
  firstProperty,
}: {
  account: Tables<"accounts">;
  parents: { id: string; name: string }[];
  firstProperty: PropertyAddress | null;
}) {
  const router = useRouter();
  const initial = useMemo<BillingDraft>(() => {
    const address = billingAddressDraft(account, firstProperty);
    return {
      company_name: account.company_name ?? "",
      billing_email: billingEmailDraft(account.billing_email, account.email),
      ...address,
      net_terms_days: account.net_terms_days,
      po_required: account.po_required,
      tax_exempt: account.tax_exempt,
      consolidated_invoicing: account.consolidated_invoicing,
      parent_account_id: account.parent_account_id ?? "",
    };
  }, [account, firstProperty]);
  const [draft, setDraft] = useState(initial);
  const [choice, setChoice] = useState(termsChoice(initial.net_terms_days));
  const [customDays, setCustomDays] = useState(choice === "custom" ? String(initial.net_terms_days) : "");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const addressDefaulted = !account.billing_address_line1 && Boolean(firstProperty?.address_line1);
  const { status, error, save, retry } = useSectionAutosave<BillingDraft>({
    initial,
    onRollback(values) {
      setDraft((current) => ({
        ...current,
        net_terms_days: values.net_terms_days,
        po_required: values.po_required,
        tax_exempt: values.tax_exempt,
        consolidated_invoicing: values.consolidated_invoicing,
        parent_account_id: values.parent_account_id,
      }));
      setChoice(termsChoice(values.net_terms_days));
      setTermsError(null);
    },
    action: async (values) => {
      const result = await updateAccountBilling(account.id, values);
      if (result.ok) router.refresh();
      return result;
    },
  });

  const flag = (key: "po_required" | "tax_exempt" | "consolidated_invoicing", checked: boolean) => {
    setDraft((current) => ({ ...current, [key]: checked }));
    save({ [key]: checked }, { immediate: true, rollback: true });
  };

  const saveAddress = () => {
    save({
      billing_address_line1: draft.billing_address_line1,
      billing_address_line2: draft.billing_address_line2,
      billing_city: draft.billing_city,
      billing_region: draft.billing_region,
      billing_postal_code: draft.billing_postal_code,
    });
  };

  return (
    <SectionCard title="Billing & terms" heading="h3" status={status} error={emailError ?? termsError ?? error} onRetry={emailError || termsError ? undefined : retry}>
      <Field>
        <FieldLabel htmlFor="company_name">Company</FieldLabel>
        <Input
          id="company_name"
          value={draft.company_name}
          className="max-md:h-12"
          onChange={(event) => setDraft({ ...draft, company_name: event.target.value })}
          onBlur={(event) => {
            const company_name = event.target.value;
            setDraft((current) => ({ ...current, company_name }));
            save({ company_name });
          }}
        />
      </Field>
      <Field data-invalid={emailError ? true : undefined}>
        <FieldLabel htmlFor="billing_email">Billing email</FieldLabel>
        <Input
          id="billing_email"
          type="email"
          inputMode="email"
          value={draft.billing_email}
          autoComplete="off"
          aria-invalid={emailError ? true : undefined}
          className="max-md:h-12"
          onChange={(event) => setDraft({ ...draft, billing_email: event.target.value })}
          onBlur={(event) => {
            const billing_email = event.target.value.trim();
            if (billing_email && !EMAIL.test(billing_email)) {
              setEmailError("Enter a valid billing email.");
              setDraft((current) => ({ ...current, billing_email: event.target.value }));
              return;
            }
            setEmailError(null);
            setDraft((current) => ({ ...current, billing_email }));
            save({ billing_email });
          }}
        />
        <FieldDescription>Stays blank until you enter a billing email.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="billing_address_line1">Billing address</FieldLabel>
        <Input
          id="billing_address_line1"
          value={draft.billing_address_line1}
          autoComplete="off"
          className="max-md:h-12"
          onChange={(event) => setDraft({ ...draft, billing_address_line1: event.target.value })}
          onBlur={saveAddress}
        />
        <Input
          aria-label="Billing address line 2"
          value={draft.billing_address_line2}
          autoComplete="off"
          className="max-md:h-12"
          onChange={(event) => setDraft({ ...draft, billing_address_line2: event.target.value })}
          onBlur={saveAddress}
        />
        <div className="grid gap-2 sm:grid-cols-[1fr_5rem_6rem]">
          <Input
            aria-label="Billing city"
            value={draft.billing_city}
            autoComplete="off"
            className="max-md:h-12"
            onChange={(event) => setDraft({ ...draft, billing_city: event.target.value })}
            onBlur={saveAddress}
          />
          <Input
            aria-label="Billing state"
            value={draft.billing_region}
            autoComplete="off"
            className="max-md:h-12"
            onChange={(event) => setDraft({ ...draft, billing_region: event.target.value })}
            onBlur={saveAddress}
          />
          <Input
            aria-label="Billing ZIP"
            value={draft.billing_postal_code}
            autoComplete="off"
            className="max-md:h-12"
            onChange={(event) => setDraft({ ...draft, billing_postal_code: event.target.value })}
            onBlur={saveAddress}
          />
        </div>
        {addressDefaulted ? <FieldDescription>Defaults to the first property.</FieldDescription> : null}
      </Field>
      <Field data-invalid={termsError ? true : undefined}>
        <FieldLabel>Terms</FieldLabel>
        <ChipGroup
          label="Terms"
          value={choice}
          options={[
            { value: "0", label: "Due" },
            { value: "15", label: "Net 15" },
            { value: "30", label: "Net 30" },
            { value: "custom", label: "Custom" },
          ]}
          onValueChange={(next) => {
            if (next !== "0" && next !== "15" && next !== "30" && next !== "custom") return;
            setChoice(next);
            if (next === "custom") return;
            const net_terms_days = Number(next);
            setTermsError(null);
            setDraft((current) => ({ ...current, net_terms_days }));
            save({ net_terms_days }, { immediate: true, rollback: true });
          }}
        />
        {choice === "custom" ? (
          <Input
            inputMode="numeric"
            aria-label="Custom net days"
            value={customDays}
            placeholder="1–120"
            className="max-md:h-12"
            onChange={(event) => setCustomDays(event.target.value)}
            onBlur={() => {
              const net_terms_days = Number(customDays);
              if (!Number.isInteger(net_terms_days) || net_terms_days < 1 || net_terms_days > 120) {
                setTermsError("Custom net days must be from 1 to 120.");
                return;
              }
              setTermsError(null);
              setDraft((current) => ({ ...current, net_terms_days }));
              save({ net_terms_days }, { immediate: true, rollback: true });
            }}
          />
        ) : null}
      </Field>
      <ToggleRow label="PO required" checked={draft.po_required} onCheckedChange={(checked) => flag("po_required", checked)} />
      <ToggleRow label="Tax exempt" checked={draft.tax_exempt} onCheckedChange={(checked) => flag("tax_exempt", checked)} />
      <ToggleRow label="Consolidated invoicing" checked={draft.consolidated_invoicing} onCheckedChange={(checked) => flag("consolidated_invoicing", checked)} />
      {account.type === "commercial" ? (
        <Field>
          <FieldLabel htmlFor="parent_account_id">Parent account</FieldLabel>
          <NativeSelect
            id="parent_account_id"
            value={draft.parent_account_id}
            className="max-md:h-12"
            onChange={(event) => {
              const parent_account_id = event.target.value;
              setDraft((current) => ({ ...current, parent_account_id }));
              save({ parent_account_id }, { immediate: true, rollback: true });
            }}
          >
            <option value="">No parent</option>
            {parents
              .filter((parent) => parent.id !== account.id)
              .map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {parent.name}
                </option>
              ))}
          </NativeSelect>
        </Field>
      ) : null}
    </SectionCard>
  );
}

function SalesCard({ account, ownerName }: { account: Tables<"accounts">; ownerName: string }) {
  const router = useRouter();
  const initial = useMemo<SalesDraft>(
    () => ({ lead_source: account.lead_source ?? "", tags: account.tags.join(", ") }),
    [account.lead_source, account.tags],
  );
  const [draft, setDraft] = useState(initial);
  const sources = draft.lead_source && !LEAD_SOURCES.includes(draft.lead_source) ? [draft.lead_source, ...LEAD_SOURCES] : LEAD_SOURCES;
  const { status, error, save, retry } = useSectionAutosave<SalesDraft>({
    initial,
    onRollback(values) {
      setDraft((current) => ({ ...current, lead_source: values.lead_source }));
    },
    action: async (values) => {
      const result = await updateAccountSales(account.id, values);
      if (result.ok) router.refresh();
      return result;
    },
  });

  return (
    <SectionCard title="Sales" heading="h3" status={status} error={error} onRetry={retry}>
      <Field>
        <FieldLabel htmlFor="lead_source">Lead source</FieldLabel>
        <NativeSelect
          id="lead_source"
          value={draft.lead_source}
          className="max-md:h-12"
          onChange={(event) => {
            const lead_source = event.target.value;
            setDraft((current) => ({ ...current, lead_source }));
            save({ lead_source }, { immediate: true, rollback: true });
          }}
        >
          <option value="">None</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="tags">Tags</FieldLabel>
        <Input
          id="tags"
          value={draft.tags}
          placeholder="hoa, weekly"
          className="max-md:h-12"
          onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
          onBlur={(event) => {
            const tags = event.target.value;
            setDraft((current) => ({ ...current, tags }));
            save({ tags });
          }}
        />
      </Field>
      <Field>
        <FieldLabel>Created by</FieldLabel>
        <p className="text-sm">{ownerName}</p>
      </Field>
    </SectionCard>
  );
}

function NotesCard({ account }: { account: Tables<"accounts"> }) {
  const router = useRouter();
  const initial = useMemo<NotesDraft>(() => ({ notes: account.notes ?? "" }), [account.notes]);
  const [notes, setNotes] = useState(initial.notes);
  const { status, error, save, retry } = useSectionAutosave<NotesDraft>({
    initial,
    action: async (values) => {
      const result = await updateAccountNotes(account.id, values);
      if (result.ok) router.refresh();
      return result;
    },
  });

  return (
    <div className="flex flex-col gap-2">
      <div role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {status === "saving" ? "Saving" : status === "saved" ? "Saved" : null}
      </div>
      <InternalNote label="Internal notes">
        <Field data-invalid={error ? true : undefined}>
          <Textarea
            id="notes"
            aria-label="Notes"
            value={notes}
            rows={4}
            aria-invalid={error ? true : undefined}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={(event) => {
              const next = event.target.value;
              setNotes(next);
              save({ notes: next });
            }}
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        {error ? (
          <Button type="button" variant="outline" onClick={retry}>
            Retry
          </Button>
        ) : null}
      </InternalNote>
    </div>
  );
}
