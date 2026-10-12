"use client";
import { useId, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SectionCard, resolveEntryTab, useSectionAutosave } from "@/components/entry";
import { companyInitials } from "@/lib/brand/initials";
import { brandingAssetUrl, isHttpUrl } from "@/lib/brand/urls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Tables } from "@/lib/supabase/types";
import { formatSeasonLabel } from "@/lib/scheduling/season";
import { updateOrgSeason } from "@/lib/actions/scheduling";
import { lookupOfficeAddress, saveOrgCard } from "./actions";
const TABS = ["identity", "company", "branding", "payments", "lead-form"] as const;
const ZONES = [["America/New_York", "Eastern"], ["America/Chicago", "Central"], ["America/Denver", "Mountain"], ["America/Phoenix", "Arizona"], ["America/Los_Angeles", "Pacific"], ["America/Anchorage", "Alaska"], ["Pacific/Honolulu", "Hawaii"], ["UTC", "UTC"]] as const;
const UNRESOLVED = "That address didn't resolve.";
const MISSED = "We couldn't find that address. Check it, or use it as typed.";
type CardId = "identity" | "contact" | "address" | "region";
type Edit = { canEdit: boolean; editing: boolean; onEdit: () => void; onDone: () => void };
type Contact = { phone: string; email: string; website: string };
type Address = { line1: string; line2: string; city: string; region: string; postal: string };
type Region = { timezone: string; currency: string; startMonth: number; startDay: number; endMonth: number; endDay: number };
function toForm(section: string, fields: Record<string, string>) {
  const data = new FormData();
  data.set("section", section);
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const phoneError = (value: string) => !value.trim() || (/^[0-9+().\-\s]+$/.test(value) && value.replace(/\D/g, "").length >= 10) ? undefined : "Enter a phone number with at least 10 digits.";
const emailError = (value: string) => !value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? undefined : "Enter a valid email.";
const websiteError = (value: string) => !value.trim() || isHttpUrl(value.trim()) ? undefined : "Enter a website that starts with http:// or https://.";
const zipError = (value: string) => !value.trim() || /^\d{5}(?:-\d{4})?$/.test(value.trim()) ? undefined : "Enter a 5-digit ZIP.";
const zoneLabel = (zone: string) => { const known = ZONES.find(([name]) => name === zone); return known ? `${known[1]} (${known[0]})` : zone; };
function useFields<T>(initial: T) {
  const [values, setValues] = useState(initial);
  const ref = useRef(initial);
  const set = (next: T) => { ref.current = next; setValues(next); };
  return [values, set, ref] as const;
}
function useOrgSave<T>(section: string, initial: T, encode: (values: T) => Record<string, string>, apply: (values: T) => void) {
  const router = useRouter();
  return useSectionAutosave<T>({ initial, onRollback: apply, action: async (values) => {
    const result = await saveOrgCard(toForm(section, encode(values)));
    if (result.ok) router.refresh();
    return result;
  } });
}
function editButton(editing: boolean, onEdit: () => void, onDone: () => void) {
  return <Button type="button" variant="ghost" className="h-11 px-3 lg:h-8" onClick={editing ? onDone : onEdit}>{editing ? "Done" : "Edit"}</Button>;
}
function TextField({ id, label, value, error, onValue, onBlur, ...props }: { id: string; label: string; value: string; error?: string; onValue: (value: string) => void; onBlur: (value: string) => void } & Pick<ComponentProps<"input">, "autoComplete" | "inputMode" | "list" | "placeholder" | "type">) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} aria-invalid={error ? true : undefined} className="max-lg:h-11" onChange={(event) => onValue(event.target.value)} onBlur={(event) => onBlur(event.currentTarget.value)} {...props} />
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}
function FactRows({ rows, onEdit }: { rows: { label: string; value: ReactNode }[]; onEdit?: () => void }) {
  return (
    <dl className="flex flex-col gap-1">
      {rows.map((row) => (
        <div key={row.label} className="grid gap-0.5 lg:grid-cols-[7.5rem_minmax(0,1fr)] lg:items-center lg:gap-x-3">
          <dt className="text-sm text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0 text-sm">{onEdit ? <button type="button" className="min-h-11 w-full rounded-md text-left lg:min-h-8" onClick={onEdit}>{row.value}</button> : row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
function IdentityCard({ org, canEdit, editing, onEdit, onDone }: Edit & { org: Tables<"orgs"> }) {
  const [name, setName] = useState(org.name);
  const nameRef = useRef(org.name);
  const writeName = (next: string) => { nameRef.current = next; setName(next); };
  const [localError, setLocalError] = useState<string | null>(null);
  const save = useOrgSave("identity", org.name, (value) => ({ name: value }), (value) => { writeName(value); setLocalError(null); });
  const logo = brandingAssetUrl(org.logo_path, org.id);
  const complete = Boolean(name.trim() && org.phone && org.email && org.address_line1 && org.city && org.region && org.postal_code);
  const commit = (raw: string) => {
    const next = raw.trim();
    writeName(next);
    if (!next) { setLocalError("Enter a company name."); return false; }
    setLocalError(null);
    save.save(next);
    return true;
  };
  return (
    <SectionCard title="Identity" heading="h2" description="Shown on quotes, proposals, invoices and public quote pages." status={save.status} error={localError ?? save.error} onRetry={save.retry} mode={editing ? "edit" : "view"} onEdit={canEdit && !editing ? onEdit : undefined} menu={canEdit ? <Button type="button" variant="ghost" className="h-11 px-3 lg:h-8" onClick={() => { if (!editing) onEdit(); else if (commit(nameRef.current)) onDone(); }}>{editing ? "Done" : "Edit"}</Button> : undefined}>
      <div className="flex flex-col gap-3">
        <Badge variant="outline" className={complete ? "border-transparent bg-success/10 text-success" : undefined}>{complete ? "Profile complete" : "Profile incomplete"}</Badge>
        {editing ? <TextField id="company-name" label="Company name" value={name} autoComplete="organization" error={localError ?? undefined} onValue={writeName} onBlur={commit} /> : <FactRows onEdit={canEdit ? onEdit : undefined} rows={[{ label: "Company", value: name }, { label: "Logo", value: logo ? <img src={logo} alt="" className="size-10 rounded-md bg-muted object-contain" /> : <span className="flex size-10 items-center justify-center rounded-md bg-muted text-sm font-medium">{companyInitials(name)}</span> }]} />}
      </div>
    </SectionCard>
  );
}
function ContactCard({ org, canEdit, editing, onEdit, onDone }: Edit & { org: Tables<"orgs"> }) {
  const initial = useMemo<Contact>(() => ({ phone: org.phone ?? "", email: org.email ?? "", website: org.website ?? "" }), [org.phone, org.email, org.website]);
  const [values, setValues, ref] = useFields(initial);
  const [errors, setErrors] = useState<Partial<Contact>>({});
  const save = useOrgSave("contact", initial, (next) => next, (next) => { setValues(next); setErrors({}); });
  const publish = (next: Contact) => {
    setValues(next);
    const nextErrors = { phone: phoneError(next.phone), email: emailError(next.email), website: websiteError(next.website) };
    setErrors(nextErrors);
    if (nextErrors.phone || nextErrors.email || nextErrors.website) return false;
    save.save(next);
    return true;
  };
  const uid = useId();
  const fields = [
    ["phone", "Phone", "tel", "The number customers call, shown on quotes and invoices."],
    ["email", "Email", "email", "Where customers reply, and where quote copies are sent."],
    ["website", "Website", "url", "Shown on quotes so customers can learn more about you."],
  ] as const;
  return (
    <SectionCard title="Contact" heading="h3" status={save.status} error={save.error} onRetry={save.retry} mode={editing ? "edit" : "view"} onEdit={canEdit && !editing ? onEdit : undefined} menu={canEdit ? <Button type="button" variant="ghost" className="h-11 px-3 lg:h-8" onClick={() => { if (!editing) onEdit(); else if (publish(ref.current)) onDone(); }}>{editing ? "Done" : "Edit"}</Button> : undefined}>
      {editing ? <div className="flex flex-col gap-4">{fields.map(([key, label, type]) => <TextField key={key} id={`${uid}-${key}`} label={label} type={type} inputMode={type} autoComplete={type} placeholder={key === "website" ? "https://" : undefined} value={values[key]} error={errors[key]} onValue={(value) => setValues({ ...ref.current, [key]: value })} onBlur={(value) => publish({ ...ref.current, [key]: value })} />)}</div> : <FactRows onEdit={canEdit ? onEdit : undefined} rows={fields.map(([key, label]) => ({ label, value: values[key] || "—" }))} />}
    </SectionCard>
  );
}
function addressFrom(org: Tables<"orgs">): Address {
  return { line1: org.address_line1 ?? "", line2: org.address_line2 ?? "", city: org.city ?? "", region: org.region ?? "", postal: org.postal_code ?? "" };
}
function AddressCard({ org, canEdit, editing, onEdit, onDone }: Edit & { org: Tables<"orgs"> }) {
  const uid = useId();
  const [saved, setSaved] = useState(() => addressFrom(org));
  const [address, setAddress] = useState(saved);
  const [postalMessage, setPostalMessage] = useState<string | undefined>();
  const [suggestion, setSuggestion] = useState<{ line1: string; city: string; region: string; postal: string; label: string } | null>(null);
  const typed = useRef(false);
  const router = useRouter();
  const save = useSectionAutosave<Address>({ initial: saved, action: async (values) => {
    const useAsTyped = typed.current;
    typed.current = false;
    const result = await saveOrgCard(toForm("address", { address_line1: values.line1, address_line2: values.line2, city: values.city, region: values.region, postal_code: values.postal, use_as_typed: useAsTyped ? "true" : "false" }));
    if (result.ok && result.address) {
      const next = { line1: result.address.address_line1 ?? "", line2: result.address.address_line2 ?? "", city: result.address.city ?? "", region: result.address.region ?? "", postal: result.address.postal_code ?? "" };
      setAddress(next);
      setSaved(next);
      router.refresh();
      onDone();
    }
    return result;
  } });
  const missed = save.error === UNRESOLVED;
  const lines = [address.line1, address.line2, [address.city, [address.region, address.postal].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean);
  const submit = (useAsTyped: boolean) => {
    const zip = zipError(address.postal);
    setPostalMessage(zip);
    if (zip) return;
    typed.current = useAsTyped;
    save.save(address, { immediate: true });
  };
  const fields: [keyof Address, string, string, string][] = [
    ["line1", "Street address", "street-address", "Your office street, used to place the company on the map."],
    ["line2", "Address line 2", "address-line2", "Suite or unit that belongs with the street address."],
    ["city", "City", "address-level2", "The city of your office, saved with the street."],
    ["region", "State", "address-level1", "The state of your office, saved with the street and city."],
    ["postal", "ZIP", "postal-code", "Your office ZIP, checked so the address is complete."],
  ];
  return (
    <SectionCard title="Office address" heading="h3" status={missed || (!editing && save.status === "error") ? "idle" : save.status} error={editing && !missed ? save.error : null} onRetry={editing && !missed ? save.retry : undefined} mode={editing ? "edit" : "view"} onEdit={canEdit && !editing ? onEdit : undefined} menu={canEdit && !editing ? editButton(false, onEdit, onDone) : undefined} actions={editing ? (
      <div className="flex w-full flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" className="h-11 lg:h-9" onClick={() => { setAddress(saved); setSuggestion(null); setPostalMessage(undefined); onDone(); }}>Cancel</Button>
        {missed ? <Button type="button" variant="secondary" className="h-11 lg:h-9" onClick={() => submit(true)}>Use as typed</Button> : null}
        <Button type="button" className="h-11 lg:h-9" disabled={save.status === "saving"} onClick={() => submit(false)}>Save</Button>
      </div>
    ) : undefined}>
      {editing ? (
        <div className="flex flex-col gap-4">
          {missed ? <p className="text-sm text-warning">{MISSED}</p> : null}
          {fields.map(([key, label, auto]) => (
            <TextField key={key} id={`${uid}-${key}`} label={label} autoComplete={auto} inputMode={key === "postal" ? "numeric" : undefined} placeholder={key === "line1" ? "Start typing an address" : undefined} value={address[key]} error={key === "postal" ? postalMessage : undefined} onValue={(value) => setAddress({ ...address, [key]: value })} onBlur={(value) => {
              if (key === "postal") setPostalMessage(zipError(value));
              if (key === "line1" && canEdit && value.trim().length >= 5) void lookupOfficeAddress(value.trim()).then((hit) => setSuggestion(hit.ok ? hit : null));
            }} />
          ))}
          {suggestion ? <Button type="button" variant="outline" className="h-auto min-h-11 justify-start whitespace-normal text-left" onMouseDown={(event) => event.preventDefault()} onClick={() => { setAddress({ ...address, line1: suggestion.line1, city: suggestion.city, region: suggestion.region, postal: suggestion.postal }); setPostalMessage(zipError(suggestion.postal)); setSuggestion(null); }}>Use {suggestion.label}</Button> : null}
        </div>
      ) : <FactRows onEdit={canEdit ? onEdit : undefined} rows={[{ label: "Address", value: lines.length ? <span>{lines.map((line) => <span key={line} className="block">{line}</span>)}</span> : "—" }]} />}
    </SectionCard>
  );
}
function RegionCard({ org, canEdit, editing, onEdit, onDone }: Edit & { org: Tables<"orgs"> }) {
  const initial = useMemo<Region>(
    () => ({
      timezone: org.timezone,
      currency: org.currency,
      startMonth: org.season_start_month,
      startDay: org.season_start_day,
      endMonth: org.season_end_month,
      endDay: org.season_end_day,
    }),
    [org.timezone, org.currency, org.season_start_month, org.season_start_day, org.season_end_month, org.season_end_day],
  );
  const [values, setValues, ref] = useFields(initial);
  const [seasonError, setSeasonError] = useState<string | null>(null);
  const router = useRouter();
  const save = useOrgSave("region", initial, (next) => ({ timezone: next.timezone, currency: next.currency }), setValues);
  const zones = [values.timezone, ...ZONES.map(([zone]) => zone)].filter((zone, index, list) => list.indexOf(zone) === index);
  const commit = (next: Region, immediate = false) => {
    setValues(next);
    if (!next.timezone.trim()) return;
    save.save(next, immediate ? { immediate: true, rollback: true } : undefined);
  };
  const commitSeason = (next: Region) => {
    setValues(next);
    void updateOrgSeason({
      startMonth: next.startMonth,
      startDay: next.startDay,
      endMonth: next.endMonth,
      endDay: next.endDay,
    }).then((result) => {
      if (result.ok) {
        setSeasonError(null);
        router.refresh();
      } else {
        setSeasonError(result.error);
      }
    });
  };
  const seasonLabel = formatSeasonLabel({
    startMonth: values.startMonth,
    startDay: values.startDay,
    endMonth: values.endMonth,
    endDay: values.endDay,
  });
  return (
    <SectionCard title="Region & time" heading="h3" status={save.status} error={seasonError ?? save.error} onRetry={save.retry} mode={editing ? "edit" : "view"} onEdit={canEdit && !editing ? onEdit : undefined} menu={canEdit ? editButton(editing, onEdit, onDone) : undefined}>
      {editing ? (
        <div className="flex flex-col gap-4">
          <TextField id="timezone" label="Timezone" list="org-timezones" value={values.timezone} onValue={(timezone) => setValues({ ...ref.current, timezone })} onBlur={(timezone) => commit({ ...ref.current, timezone })} />
          <datalist id="org-timezones">{zones.map((zone) => <option key={zone} value={zone} />)}</datalist>
          <Field>
            <FieldLabel htmlFor="currency">Currency</FieldLabel>
            <select id="currency" className="native-control max-lg:h-11" value={values.currency} onChange={(event) => commit({ ...ref.current, currency: event.target.value }, true)}>
              {[values.currency, "USD", "CAD"].filter((value, index, list) => list.indexOf(value) === index).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                ["startMonth", "Season start month", "The month recurring lawn visits begin."],
                ["startDay", "Season start day", "The day of the month recurring lawn visits begin."],
                ["endMonth", "Season end month", "The month recurring lawn visits stop for the year."],
                ["endDay", "Season end day", "The day of the month recurring lawn visits stop."],
              ] as const
            ).map(([key, label]) => (
              <Field key={key}>
                <FieldLabel htmlFor={`org-${key}`}>{label}</FieldLabel>
                <Input
                  id={`org-${key}`}
                  type="number"
                  min={1}
                  max={key.endsWith("Month") ? 12 : 31}
                 
                  className="max-lg:h-11"
                  value={values[key]}
                  onChange={(event) => setValues({ ...ref.current, [key]: Number(event.target.value) })}
                  onBlur={() => commitSeason(ref.current)}
                />
              </Field>
            ))}
          </div>
        </div>
      ) : (
        <FactRows
          onEdit={canEdit ? onEdit : undefined}
          rows={[
            { label: "Timezone", value: zoneLabel(values.timezone) },
            { label: "Currency", value: values.currency },
            { label: "Season", value: seasonLabel },
          ]}
        />
      )}
    </SectionCard>
  );
}
const NAV = [{ label: "Identity", tab: "identity" }, { label: "Company", tab: "company" }, { label: "Branding", tab: "branding" }, { label: "Payments", tab: "payments" }, { label: "Lead form", tab: "lead-form", ownerOnly: true }, { label: "Messages", href: "/settings/messages" }, { label: "Texting", href: "/settings/texting" }, { label: "Sending", href: "/settings/sending" }, { label: "Team", href: "/settings/team" }, { label: "Crews", href: "/settings/crews" }, { label: "Services & Pricing", href: "/settings/pricing" }] as const;
export function OrgSettingsForm({ org, canEdit, tab, branding, payments, leadForm, isOwner = false }: { org: Tables<"orgs">; canEdit: boolean; tab?: string; branding: ReactNode; payments: ReactNode; leadForm?: ReactNode; isOwner?: boolean }) {
  const tabs = isOwner ? TABS : TABS.filter((name) => name !== "lead-form");
  const [current, setCurrent] = useState(() => resolveEntryTab(tab, tabs, "company"));
  const [open, setOpen] = useState<CardId | null>(null);
  const edit = (id: CardId): Edit => ({ canEdit, editing: open === id, onEdit: () => setOpen(id), onDone: () => setOpen(null) });
  const show = (next: (typeof tabs)[number]) => { setCurrent(next); setOpen(null); };
  const itemClass = (active: boolean) => `shrink-0 whitespace-nowrap rounded-md px-3 text-left max-lg:inline-flex max-lg:h-11 max-lg:items-center lg:w-full lg:px-2 lg:py-1.5 ${active ? "bg-muted font-medium" : "hover:bg-muted"}`;
  const nav = NAV.filter((item) => !("ownerOnly" in item && item.ownerOnly) || isOwner);
  return (
    <div className="flex w-full min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
      <nav aria-label="Settings" className="flex w-full min-w-0 flex-nowrap gap-1 overflow-x-auto text-sm lg:w-44 lg:shrink-0 lg:flex-col lg:overflow-visible">
        {nav.map((item) => "href" in item ? <Link key={item.href} href={item.href} className={itemClass(false)}>{item.label}</Link> : <button key={item.tab} type="button" className={itemClass(current === item.tab)} aria-current={current === item.tab ? "page" : undefined} onClick={() => show(item.tab)}>{item.label}</button>)}
      </nav>
      <div className="flex w-full min-w-0 flex-1 flex-col gap-4">
        {current === "identity" ? <IdentityCard org={org} {...edit("identity")} /> : null}
        {current === "company" ? (
          <section aria-labelledby="settings-company-heading" className="grid w-full min-w-0 items-start gap-4 lg:grid-cols-2">
            <h2 id="settings-company-heading" className="text-base font-medium lg:col-span-2">Company</h2>
            <ContactCard org={org} {...edit("contact")} />
            <AddressCard org={org} {...edit("address")} />
            <RegionCard org={org} {...edit("region")} />
          </section>
        ) : null}
        {current === "branding" ? branding : null}
        {current === "payments" ? <div className="w-full min-w-0">{payments}</div> : null}
        {current === "lead-form" ? <div className="w-full min-w-0">{leadForm}</div> : null}
      </div>
    </div>
  );
}
