"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { AccountDuplicateNotice } from "@/components/accounts/duplicate-notice";
import { ChipGroup, MoreDisclosure, ToggleRow } from "@/components/entry";
import type { AccountDuplicate } from "@/lib/accounts/duplicates";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { GeocodeResult } from "@/lib/geo/types";
import { parseStreetAddress } from "./[id]/property-quick-add";
import { LEAD_SOURCES } from "@/lib/leads/lead-source";
import { suggestPropertyAddresses } from "./address-suggest";
import { identityError, normalizeIdentity } from "./account-format";
import { BILLING_DETAILS_LABEL } from "./billing-details";
import { createAccount, createProperty } from "./actions";
import { lookupAccountDuplicates } from "./duplicate-action";

type FieldName = "name" | "phone" | "email" | "billing" | "terms" | "address" | "source";

function streetOf(picked: GeocodeResult | null, address: string) {
  if (picked?.addressLine1 && picked.city && picked.region && picked.postalCode) {
    return { address_line1: picked.addressLine1, city: picked.city, region: picked.region, postal_code: picked.postalCode };
  }
  return address.trim() ? parseStreetAddress(address) : null;
}

export function NewCustomerDialog({ startOpen = false }: { startOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const [type, setType] = useState<"residential" | "commercial">("residential");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [picked, setPicked] = useState<GeocodeResult | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [showBusiness, setShowBusiness] = useState(false);
  const [company, setCompany] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [terms, setTerms] = useState("0");
  const [customDays, setCustomDays] = useState("");
  const [poRequired, setPoRequired] = useState(false);
  const [taxExempt, setTaxExempt] = useState(false);
  const [consolidated, setConsolidated] = useState(false);
  const [source, setSource] = useState("");
  const [sourceOther, setSourceOther] = useState("");
  const [notes, setNotes] = useState("");
  const [invalid, setInvalid] = useState<FieldName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [duplicateMatches, setDuplicateMatches] = useState<AccountDuplicate[]>([]);
  const [confirmedProbe, setConfirmedProbe] = useState<string | null>(null);
  const business = type === "commercial" || showBusiness;

  useEffect(() => {
    const query = address.trim();
    if (query.length < 3 || picked?.formattedAddress === address) return;
    let current = true;
    const timer = setTimeout(() => {
      void suggestPropertyAddresses(query).then((next) => {
        if (current) setSuggestions(next);
      });
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [address, picked]);

  const reject = (field: FieldName, message: string) => {
    setInvalid(field);
    setError(message);
  };

  const submit = () => {
    const days = terms === "custom" ? Number(customDays) : Number(terms);
    const identity = identityError({ type, name, phone, email });
    const street = streetOf(picked, address);
    const field: FieldName | null = identity
      ? identity.startsWith("Name")
        ? "name"
        : identity.includes("email") && !identity.includes("phone")
          ? "email"
          : "phone"
      : billingEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail.trim())
        ? "billing"
        : terms === "custom" && (!Number.isInteger(days) || days < 1 || days > 120)
          ? "terms"
          : address.trim() && !street
            ? "address"
            : source === "Other" && !sourceOther.trim()
              ? "source"
              : null;
    const message = identity
      ?? (field === "billing" ? "Enter a valid billing email." : null)
      ?? (field === "terms" ? "Custom net days must be from 1 to 120." : null)
      ?? (field === "address" ? "Pick an address, or use Street, City, ST ZIP." : null)
      ?? (field === "source" ? "Describe the lead source when Other is selected." : null);
    if (field && message) {
      reject(field, message);
      return;
    }
    const normalized = normalizeIdentity({ type, name, phone, email });
    const probeKey = `${normalized.phone}|${street?.address_line1 ?? ""}|${street?.city ?? ""}|${street?.postal_code ?? ""}`;
    startTransition(async () => {
      if (confirmedProbe !== probeKey) {
        const found = await lookupAccountDuplicates({
          phones: normalized.phone ? [normalized.phone] : [],
          addresses: street
            ? [{ addressLine1: street.address_line1, city: street.city, postalCode: street.postal_code }]
            : [],
        });
        if (!found.ok) {
          reject("name", found.error);
          return;
        }
        if (found.data.length) {
          setDuplicateMatches(found.data);
          setConfirmedProbe(probeKey);
          return;
        }
        setDuplicateMatches([]);
      }
      let accountId = savedId;
      if (!accountId) {
        const fd = new FormData();
        fd.set("type", type);
        fd.set("status", "lead");
        fd.set("name", normalized.name);
        fd.set("phone", normalized.phone);
        fd.set("email", normalized.email);
        fd.set("company_name", company);
        // Billing email stays blank unless entered — never copy account email.
        fd.set("billing_email", billingEmail.trim());
        if (street) {
          fd.set("billing_address_line1", street.address_line1);
          fd.set("billing_city", street.city);
          fd.set("billing_region", street.region);
          fd.set("billing_postal_code", street.postal_code);
        }
        fd.set("net_terms_days", String(days));
        fd.set("lead_source", source);
        fd.set("lead_source_other", source === "Other" ? sourceOther : "");
        fd.set("notes", notes);
        if (poRequired) fd.set("po_required", "true");
        if (taxExempt) fd.set("tax_exempt", "true");
        if (consolidated) fd.set("consolidated_invoicing", "true");
        const created = await createAccount(fd);
        if (!created.ok) {
          reject("name", created.error);
          return;
        }
        accountId = created.data.id;
        setSavedId(accountId);
      }
      if (!street) {
        router.push(`/accounts/${accountId}`);
        return;
      }
      const propertyFd = new FormData();
      propertyFd.set("address_line1", street.address_line1);
      propertyFd.set("city", street.city);
      propertyFd.set("region", street.region);
      propertyFd.set("postal_code", street.postal_code);
      const property = await createProperty(accountId, propertyFd);
      if (!property.ok) {
        reject("address", property.error);
        return;
      }
      router.push(`/properties/${property.data.id}/measure`);
    });
  };

  const fieldError = (field: FieldName) => (invalid === field && error ? <FieldError>{error}</FieldError> : null);

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next && startOpen) router.push("/accounts"); }}>
      {startOpen ? null : (
        <DialogTrigger render={<Button />}>
          <Plus data-icon="inline-start" />
          New customer
        </DialogTrigger>
      )}
      <DialogContent className="flex max-h-[100dvh] flex-col overflow-hidden max-lg:top-0 max-lg:left-0 max-lg:h-[100dvh] max-lg:max-w-none max-lg:translate-x-0 max-lg:translate-y-0 max-lg:rounded-none lg:max-w-lg">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>A lead, ready to measure if you add an address.</DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <ChipGroup label="Account type" value={type} options={[{ value: "residential", label: "Residential" }, { value: "commercial", label: "Commercial" }]} onValueChange={(next) => {
            if (next !== "residential" && next !== "commercial") return;
            setType(next);
            if (next !== "residential") return;
            setShowBusiness(false);
            setCompany("");
            setBillingEmail("");
            setTerms("0");
            setCustomDays("");
            setPoRequired(false);
            setTaxExempt(false);
            setConsolidated(false);
          }} />
          <Field data-invalid={invalid === "name" ? true : undefined}>
            <FieldLabel htmlFor="new-name">Name</FieldLabel>
            <Input id="new-name" autoComplete="name" value={name} aria-invalid={invalid === "name" ? true : undefined} className="h-12 font-serif text-2xl" onChange={(event) => setName(event.target.value)} />
            {fieldError("name")}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field data-invalid={invalid === "phone" ? true : undefined}>
              <FieldLabel htmlFor="new-phone">Mobile</FieldLabel>
              <Input id="new-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} aria-invalid={invalid === "phone" ? true : undefined} className="max-lg:h-12" onChange={(event) => { setPhone(event.target.value); setConfirmedProbe(null); setDuplicateMatches([]); }} />
              {fieldError("phone")}
            </Field>
            <Field data-invalid={invalid === "email" ? true : undefined}>
              <FieldLabel htmlFor="new-email">Email</FieldLabel>
              <Input id="new-email" type="email" inputMode="email" autoComplete="email" value={email} aria-invalid={invalid === "email" ? true : undefined} className="max-lg:h-12" onChange={(event) => setEmail(event.target.value)} />
              {fieldError("email")}
            </Field>
          </div>
          <Field data-invalid={invalid === "address" ? true : undefined}>
            <FieldLabel htmlFor="new-address">Service address</FieldLabel>
            <Input id="new-address" role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} autoComplete="street-address" value={address} placeholder="Start typing an address" aria-invalid={invalid === "address" ? true : undefined} className="max-lg:h-12" onChange={(event) => { setAddress(event.target.value); setPicked(null); setSuggestions([]); setConfirmedProbe(null); setDuplicateMatches([]); }} />
            <div role="listbox" aria-label="Address suggestions" hidden={suggestions.length === 0}>
              {suggestions.map((suggestion) => (
                <Button key={suggestion.placeId ?? suggestion.formattedAddress} type="button" role="option" variant="ghost" className="min-h-11 w-full justify-start" onClick={() => { setAddress(suggestion.formattedAddress); setPicked(suggestion); setSuggestions([]); setConfirmedProbe(null); setDuplicateMatches([]); }}>
                  {suggestion.formattedAddress}
                </Button>
              ))}
            </div>
            {fieldError("address")}
            {savedId && invalid === "address" ? <Link href={`/accounts/${savedId}`} className="text-sm underline">The account was saved. Open it.</Link> : null}
          </Field>
          {business ? null : <Button type="button" variant="ghost" className="justify-start" onClick={() => setShowBusiness(true)}>{BILLING_DETAILS_LABEL}</Button>}
          {business ? (
            <div className="flex flex-col gap-3">
              <Field><FieldLabel htmlFor="new-company">Company</FieldLabel><Input id="new-company" value={company} onChange={(event) => setCompany(event.target.value)} /></Field>
              <Field data-invalid={invalid === "billing" ? true : undefined}>
                <FieldLabel htmlFor="new-billing-email">Billing email</FieldLabel>
                <Input id="new-billing-email" type="email" inputMode="email" autoComplete="off" value={billingEmail} aria-invalid={invalid === "billing" ? true : undefined} onChange={(event) => setBillingEmail(event.target.value)} />
                {fieldError("billing")}
              </Field>
              <ChipGroup label="Terms" value={terms} options={[{ value: "0", label: "Due" }, { value: "15", label: "Net 15" }, { value: "30", label: "Net 30" }, { value: "custom", label: "Custom" }]} onValueChange={setTerms} />
              {terms === "custom" ? <Input inputMode="numeric" aria-label="Custom net days" aria-invalid={invalid === "terms" ? true : undefined} value={customDays} placeholder="1–120" onChange={(event) => setCustomDays(event.target.value)} /> : null}
              {fieldError("terms")}
              <ToggleRow label="PO required" checked={poRequired} onCheckedChange={setPoRequired} />
              <ToggleRow label="Tax exempt" checked={taxExempt} onCheckedChange={setTaxExempt} />
              <ToggleRow label="Consolidated invoicing" checked={consolidated} onCheckedChange={setConsolidated} />
            </div>
          ) : null}
          <MoreDisclosure label="+ More">
            <div className="flex flex-col gap-3">
              <Field data-invalid={invalid === "source" ? true : undefined}>
                <FieldLabel htmlFor="new-source">Lead source</FieldLabel>
                <NativeSelect
                  id="new-source"
                  value={source}
                  aria-invalid={invalid === "source" ? true : undefined}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSource(next);
                    if (next !== "Other") setSourceOther("");
                  }}
                >
                  <option value="">None</option>
                  {LEAD_SOURCES.map((item) => <option key={item} value={item}>{item}</option>)}
                </NativeSelect>
                {source === "Other" ? (
                  <Input
                    id="new-source-other"
                    className="mt-2 max-lg:h-12"
                    value={sourceOther}
                    placeholder="How did they find you?"
                    aria-label="Other lead source"
                    aria-invalid={invalid === "source" ? true : undefined}
                    onChange={(event) => setSourceOther(event.target.value)}
                  />
                ) : null}
                {fieldError("source")}
              </Field>
              <Field><FieldLabel htmlFor="new-notes">Notes</FieldLabel><Textarea id="new-notes" value={notes} rows={3} onChange={(event) => setNotes(event.target.value)} /></Field>
            </div>
          </MoreDisclosure>
          </div>
          <div className="sticky bottom-0 flex shrink-0 flex-col gap-2 border-t bg-background pt-3 pb-[env(safe-area-inset-bottom)]">
            <AccountDuplicateNotice matches={duplicateMatches} />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">{duplicateMatches.length ? "Create anyway keeps this as a separate customer." : "Status starts as Lead"}</p>
              <Button type="submit" disabled={pending} className="min-h-11">{duplicateMatches.length ? "Create anyway" : address.trim() ? "Create & measure →" : "Create"}</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
