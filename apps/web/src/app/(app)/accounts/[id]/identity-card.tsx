"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChipGroup, SectionCard, useSectionAutosave } from "@/components/entry";
import { Field, FieldError, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Tables } from "@/lib/supabase/types";
import { identityError, normalizeIdentity, type IdentityDraft } from "../account-format";
import { findAccountMatch, updateAccountIdentity } from "../identity-action";

export function IdentityCard({ account, canEdit = true }: { account: Tables<"accounts">; canEdit?: boolean }) {
  const router = useRouter();
  const fieldsRef = useRef<HTMLDivElement>(null);
  const initial = useMemo<IdentityDraft>(
    () => ({
      type: account.type,
      name: account.name,
      phone: account.phone ?? "",
      email: account.email ?? "",
    }),
    [account.type, account.name, account.phone, account.email],
  );
  const [draft, setDraft] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<"name" | "phone" | "email" | null>(null);
  const [match, setMatch] = useState<{ id: string; name: string } | null>(null);

  const { status, error, save, retry } = useSectionAutosave<IdentityDraft>({
    initial,
    onRollback(values) {
      setDraft((current) => ({ ...current, type: values.type }));
      setFieldError(null);
    },
    action: async (values) => {
      const result = await updateAccountIdentity(account.id, values);
      if (!result.ok) return result;
      const found = await findAccountMatch(account.id, values.phone, values.email);
      if (found.ok) setMatch(found.data);
      router.refresh();
      return result;
    },
  });

  const blurField = (next: IdentityDraft, field: "name" | "phone" | "email", related: EventTarget | null) => {
    if (related instanceof Node && fieldsRef.current?.contains(related)) return;
    const message = identityError(next);
    setInvalidField(message ? field : null);
    setFieldError(message);
    if (message) {
      setDraft(next);
      return;
    }
    const normalized = normalizeIdentity(next);
    setDraft(normalized);
    save(normalized);
    setEditing(false);
  };

  const inEdit = canEdit && editing;

  return (
    <SectionCard
      title="Identity"
      heading="h3"
      status={status}
      error={fieldError ? null : error}
      onRetry={retry}
      mode={inEdit ? "edit" : "view"}
      onEdit={canEdit ? () => setEditing(true) : undefined}
      facts={[
        { label: "Type", value: draft.type === "commercial" ? "Commercial" : "Residential" },
        { label: "Name", value: draft.name },
        { label: "Mobile", value: draft.phone || "Add mobile" },
        { label: "Email", value: draft.email || "Add email" },
      ]}
    >
      <div className="flex min-w-0 flex-col gap-1">
      <ChipGroup
        label="Account type"
        options={[
          { value: "residential", label: "Residential" },
          { value: "commercial", label: "Commercial" },
        ]}
        value={draft.type}
        onValueChange={(next) => {
          if (next !== "residential" && next !== "commercial") return;
          setDraft((current) => ({ ...current, type: next }));
          save({ type: next }, { immediate: true, rollback: true });
          setEditing(false);
        }}
      />
      <FieldHint>A home is residential, and a business is commercial.</FieldHint>
      </div>
      <div ref={fieldsRef} className="flex flex-col gap-3">
        <Field data-invalid={invalidField === "name" ? true : undefined}>
          <FieldLabel htmlFor="account-name">Name</FieldLabel>
          <Input
            id="account-name"
            autoComplete="name"
            value={draft.name}
            aria-describedby="account-name-hint"
            aria-invalid={invalidField === "name" ? true : undefined}
            className="h-12 font-serif text-2xl"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            onBlur={(event) => blurField({ ...draft, name: event.target.value }, "name", event.relatedTarget)}
          />
          <FieldHint id="account-name-hint">The name on quotes, invoices, and the customer list.</FieldHint>
          {invalidField === "name" && fieldError ? <FieldError>{fieldError}</FieldError> : null}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field data-invalid={invalidField === "phone" ? true : undefined}>
            <FieldLabel htmlFor="account-phone">Mobile</FieldLabel>
            <Input
              id="account-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={draft.phone}
              aria-describedby="account-phone-hint"
              aria-invalid={invalidField === "phone" ? true : undefined}
              className="max-md:h-12"
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
              onBlur={(event) => blurField({ ...draft, phone: event.target.value }, "phone", event.relatedTarget)}
            />
            <FieldHint id="account-phone-hint">The number used for texts and calls.</FieldHint>
            {invalidField === "phone" && fieldError ? <FieldError>{fieldError}</FieldError> : null}
          </Field>
          <Field data-invalid={invalidField === "email" ? true : undefined}>
            <FieldLabel htmlFor="account-email">Email</FieldLabel>
            <Input
              id="account-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={draft.email}
              aria-describedby="account-email-hint"
              aria-invalid={invalidField === "email" ? true : undefined}
              className="max-md:h-12"
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
              onBlur={(event) => blurField({ ...draft, email: event.target.value }, "email", event.relatedTarget)}
            />
            <FieldHint id="account-email-hint">Where quotes and invoices are sent.</FieldHint>
            {invalidField === "email" && fieldError ? <FieldError>{fieldError}</FieldError> : null}
          </Field>
        </div>
      </div>
      {match ? (
        <p className="text-sm">
          Possible match:{" "}
          <Link href={`/accounts/${match.id}`} className="underline">
            {match.name} →
          </Link>
        </p>
      ) : null}
    </SectionCard>
  );
}
