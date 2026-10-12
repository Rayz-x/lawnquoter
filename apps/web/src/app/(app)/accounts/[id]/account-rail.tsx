"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChipGroup, InternalNote, SectionCard, ToggleRow, useSectionAutosave } from "@/components/entry";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { LEAD_SOURCES, WEBSITE_FORM_SOURCE } from "@/lib/leads/lead-source";
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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function termsChoice(days: number): "0" | "15" | "30" | "custom" {
  if (days === 0) return "0";
  if (days === 15) return "15";
  if (days === 30) return "30";
  return "custom";
}

function termsLabel(days: number) {
  if (days === 0) return "Due";
  if (days === 15) return "Net 15";
  if (days === 30) return "Net 30";
  return `Net ${days}`;
}

export function AccountRail({
  account,
  parents,
  ownerName,
  firstProperty = null,
  canEdit = true,
}: {
  account: Tables<"accounts">;
  parents: { id: string; name: string }[];
  ownerName: string;
  firstProperty?: PropertyAddress | null;
  canEdit?: boolean;
}) {
  const [billingOpen, setBillingOpen] = useState(shouldOpenBillingDetails(account));
  return (
    <div className="flex flex-col gap-4">
      {!canEdit ? (
        shouldOpenBillingDetails(account) ? (
          <BillingCard account={account} parents={parents} firstProperty={firstProperty} canEdit={false} />
        ) : null
      ) : billingOpen ? (
        <BillingCard account={account} parents={parents} firstProperty={firstProperty} canEdit />
      ) : (
        <Button type="button" variant="ghost" className="min-h-11 justify-start" onClick={() => setBillingOpen(true)}>
          {BILLING_DETAILS_LABEL}
        </Button>
      )}
      <SalesCard account={account} ownerName={ownerName} canEdit={canEdit} />
      <NotesCard account={account} canEdit={canEdit} />
    </div>
  );
}

function BillingCard({
  account,
  parents,
  firstProperty,
  canEdit,
}: {
  account: Tables<"accounts">;
  parents: { id: string; name: string }[];
  firstProperty: PropertyAddress | null;
  canEdit: boolean;
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

  const parentName = parents.find((parent) => parent.id === draft.parent_account_id)?.name;
  const addressLine = [
    draft.billing_address_line1,
    draft.billing_address_line2,
    [draft.billing_city, draft.billing_region, draft.billing_postal_code].filter(Boolean).join(", "),
  ]
    .filter((part) => part.trim())
    .join(" · ");

  if (!canEdit) {
    if (!shouldOpenBillingDetails(account) && !draft.company_name && !draft.billing_email) return null;
    return (
      <SectionCard
        title="Billing & terms"
        heading="h3"
        mode="view"
        facts={[
          { label: "Company", value: draft.company_name || "—" },
          { label: "Billing email", value: draft.billing_email || "—" },
          { label: "Billing address", value: addressLine || "—" },
          { label: "Terms", value: termsLabel(draft.net_terms_days) },
          { label: "PO required", value: draft.po_required ? "Yes" : "No" },
          { label: "Tax exempt", value: draft.tax_exempt ? "Yes" : "No" },
          { label: "Consolidated invoicing", value: draft.consolidated_invoicing ? "Yes" : "No" },
          ...(account.type === "commercial" ? [{ label: "Parent account", value: parentName || "No parent" }] : []),
        ]}
      />
    );
  }

  return (
    <SectionCard title="Billing & terms" heading="h3" status={status} error={emailError ?? termsError ?? error} onRetry={emailError || termsError ? undefined : retry}>
      <Field>
        <FieldLabel htmlFor="company_name">Company</FieldLabel>
        <Input
          id="company_name"
          aria-describedby="company-name-hint"
          value={draft.company_name}
          className="max-md:h-12"
          onChange={(event) => setDraft({ ...draft, company_name: event.target.value })}
          onBlur={(event) => {
            const company_name = event.target.value;
            setDraft((current) => ({ ...current, company_name }));
            save({ company_name });
          }}
        />
        <FieldHint id="company-name-hint">The business name printed on invoices.</FieldHint>
      </Field>
      <Field data-invalid={emailError ? true : undefined}>
        <FieldLabel htmlFor="billing_email">Billing email</FieldLabel>
        <Input
          id="billing_email"
          type="email"
          inputMode="email"
          value={draft.billing_email}
          autoComplete="off"
          aria-describedby="billing-email-hint"
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
        <FieldHint id="billing-email-hint">Where invoices go when it differs from the customer's email.</FieldHint>
      </Field>
      <Field>
        <FieldLabel htmlFor="billing_address_line1">Billing address</FieldLabel>
        <Input
          id="billing_address_line1"
          aria-describedby="billing-address-hint"
          value={draft.billing_address_line1}
          autoComplete="off"
          className="max-md:h-12"
          onChange={(event) => setDraft({ ...draft, billing_address_line1: event.target.value })}
          onBlur={saveAddress}
        />
        <Input
          aria-label="Billing address line 2"
          aria-describedby="billing-address-hint"
          value={draft.billing_address_line2}
          autoComplete="off"
          className="max-md:h-12"
          onChange={(event) => setDraft({ ...draft, billing_address_line2: event.target.value })}
          onBlur={saveAddress}
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_5rem_6rem]">
          <Input
            aria-label="Billing city"
            aria-describedby="billing-address-hint"
            value={draft.billing_city}
            autoComplete="off"
            className="max-md:h-12"
            onChange={(event) => setDraft({ ...draft, billing_city: event.target.value })}
            onBlur={saveAddress}
          />
          <Input
            aria-label="Billing state"
            aria-describedby="billing-address-hint"
            value={draft.billing_region}
            autoComplete="off"
            className="max-md:h-12"
            onChange={(event) => setDraft({ ...draft, billing_region: event.target.value })}
            onBlur={saveAddress}
          />
          <Input
            aria-label="Billing ZIP"
            aria-describedby="billing-address-hint"
            value={draft.billing_postal_code}
            autoComplete="off"
            className="max-md:h-12"
            onChange={(event) => setDraft({ ...draft, billing_postal_code: event.target.value })}
            onBlur={saveAddress}
          />
        </div>
        <FieldHint id="billing-address-hint">The street, city, state, and ZIP printed on this customer's invoices.</FieldHint>
        {addressDefaulted ? <FieldDescription>Starts as the first property until you change it.</FieldDescription> : null}
      </Field>
      <Field data-invalid={termsError ? true : undefined}>
        <FieldLabel>Terms</FieldLabel>
        <div className="flex min-w-0 flex-col gap-1">
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
        <FieldHint>How many days after the invoice before payment is due.</FieldHint>
        </div>
        {choice === "custom" ? (
          <div className="flex min-w-0 flex-col gap-1">
          <Input
            inputMode="numeric"
            aria-label="Custom net days"
            aria-describedby="custom-net-days-hint"
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
          <FieldHint id="custom-net-days-hint">A custom number of days, from 1 to 120.</FieldHint>
          </div>
        ) : null}
      </Field>
      <div className="flex min-w-0 flex-col gap-1"><ToggleRow label="PO required" checked={draft.po_required} onCheckedChange={(checked) => flag("po_required", checked)} /><FieldHint>A purchase order is required before this customer is invoiced.</FieldHint></div>
      <div className="flex min-w-0 flex-col gap-1"><ToggleRow label="Tax exempt" checked={draft.tax_exempt} onCheckedChange={(checked) => flag("tax_exempt", checked)} /><FieldHint>Invoices for this customer leave off sales tax.</FieldHint></div>
      <div className="flex min-w-0 flex-col gap-1"><ToggleRow label="Consolidated invoicing" checked={draft.consolidated_invoicing} onCheckedChange={(checked) => flag("consolidated_invoicing", checked)} /><FieldHint>One bill covers every property for the month.</FieldHint></div>
      {account.type === "commercial" ? (
        <Field>
          <FieldLabel htmlFor="parent_account_id">Parent account</FieldLabel>
          <NativeSelect
            id="parent_account_id"
            aria-describedby="parent-account-hint"
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
          <FieldHint id="parent-account-hint">Bills and reports can roll up to this other company.</FieldHint>
        </Field>
      ) : null}
    </SectionCard>
  );
}

function SalesCard({ account, ownerName, canEdit }: { account: Tables<"accounts">; ownerName: string; canEdit: boolean }) {
  const router = useRouter();
  const initial = useMemo<SalesDraft>(
    () => ({
      lead_source: account.lead_source ?? "",
      lead_source_other: account.lead_source_other ?? "",
      tags: account.tags.join(", "),
    }),
    [account.lead_source, account.lead_source_other, account.tags],
  );
  const [draft, setDraft] = useState(initial);
  const systemSource = draft.lead_source === WEBSITE_FORM_SOURCE;
  const { status, error, save, retry } = useSectionAutosave<SalesDraft>({
    initial,
    onRollback(values) {
      setDraft((current) => ({
        ...current,
        lead_source: values.lead_source,
        lead_source_other: values.lead_source_other,
      }));
    },
    action: async (values) => {
      const result = await updateAccountSales(account.id, values);
      if (result.ok) router.refresh();
      return result;
    },
  });

  if (!canEdit) {
    return (
      <SectionCard
        title="Sales"
        heading="h3"
        mode="view"
        facts={[
          { label: "Lead source", value: draft.lead_source || "—" },
          { label: "Tags", value: draft.tags || "—" },
          { label: "Created by", value: ownerName },
        ]}
      />
    );
  }

  return (
    <SectionCard title="Sales" heading="h3" status={status} error={error} onRetry={retry}>
      <Field>
        <FieldLabel htmlFor="lead_source">Lead source</FieldLabel>
        <NativeSelect
          id="lead_source"
          aria-describedby="lead-source-hint"
          value={draft.lead_source}
          className="max-md:h-12"
          onChange={(event) => {
            const lead_source = event.target.value;
            const lead_source_other = lead_source === "Other" ? draft.lead_source_other : "";
            setDraft((current) => ({ ...current, lead_source, lead_source_other }));
            if (lead_source === "Other" && !lead_source_other.trim()) return;
            save({ lead_source, lead_source_other }, { immediate: true, rollback: true });
          }}
        >
          <option value="">None</option>
          {systemSource ? <option value={WEBSITE_FORM_SOURCE}>{WEBSITE_FORM_SOURCE}</option> : null}
          {LEAD_SOURCES.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </NativeSelect>
        <FieldHint id="lead-source-hint">How this customer first found you.</FieldHint>
      </Field>
      {draft.lead_source === "Other" ? (
        <Field>
          <FieldLabel htmlFor="lead_source_other">Other source</FieldLabel>
          <Input
            id="lead_source_other"
            aria-describedby="lead-source-other-hint"
            value={draft.lead_source_other}
            placeholder="How did they find you?"
            className="max-md:h-12"
            onChange={(event) => setDraft({ ...draft, lead_source_other: event.target.value })}
            onBlur={(event) => {
              const lead_source_other = event.target.value;
              setDraft((current) => ({ ...current, lead_source_other }));
              if (!lead_source_other.trim()) return;
              save({ lead_source: "Other", lead_source_other });
            }}
          />
          <FieldHint id="lead-source-other-hint">The source name when it is not in the list.</FieldHint>
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor="tags">Tags</FieldLabel>
        <Input
          id="tags"
          aria-describedby="tags-hint"
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
        <FieldHint id="tags-hint">Words you can filter this customer by, separated by commas.</FieldHint>
      </Field>
      <Field>
        <FieldLabel>Created by</FieldLabel>
        <p className="text-sm">{ownerName}</p>
      </Field>
    </SectionCard>
  );
}

function NotesCard({ account, canEdit }: { account: Tables<"accounts">; canEdit: boolean }) {
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

  if (!canEdit) {
    return (
      <SectionCard
        title="Internal notes"
        heading="h3"
        mode="view"
        weight="internal"
        facts={[{ label: "Notes", value: notes.trim() || "—" }]}
      />
    );
  }

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
            aria-describedby="account-notes-hint"
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
          <FieldHint id="account-notes-hint">Office notes about this customer, which the customer does not see.</FieldHint>
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
