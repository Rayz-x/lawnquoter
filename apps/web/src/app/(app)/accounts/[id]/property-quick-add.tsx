"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { GeocodeResult } from "@/lib/geo/types";
import { suggestPropertyAddresses } from "../address-suggest";
import { createProperty } from "../actions";

export function parseStreetAddress(raw: string) {
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  const regionZip = parts[2]?.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!parts[0] || !parts[1] || !regionZip?.[1] || !regionZip[2]) return null;
  return { address_line1: parts[0], city: parts[1], region: regionZip[1].toUpperCase(), postal_code: regionZip[2] };
}

function fromSuggestion(result: GeocodeResult) {
  if (!result.addressLine1 || !result.city || !result.region || !result.postalCode) return null;
  return { address_line1: result.addressLine1, city: result.city, region: result.region, postal_code: result.postalCode };
}

export function PropertyQuickAdd({ accountId, canEdit = true }: { accountId: string; canEdit?: boolean }) {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [picked, setPicked] = useState<GeocodeResult | null>(null);
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const query = address.trim();
    if (query.length < 3 || picked?.formattedAddress === address) return;
    let current = true;
    const timer = setTimeout(() => {
      void suggestPropertyAddresses(query).then((next) => {
        if (current) setSuggestions(next);
      });
    }, 300);
    return () => { current = false; clearTimeout(timer); };
  }, [address, picked]);

  const submit = () => {
    const parsed = (picked ? fromSuggestion(picked) : null) ?? parseStreetAddress(address);
    if (!parsed) {
      setError("Pick an address, or use Street, City, ST ZIP.");
      return;
    }
    const fd = new FormData();
    fd.set("address_line1", parsed.address_line1);
    fd.set("city", parsed.city);
    fd.set("region", parsed.region);
    fd.set("postal_code", parsed.postal_code);
    startTransition(async () => {
      const result = await createProperty(accountId, fd);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      result.data.warnings.forEach((warning) => toast.warning(warning));
      router.push(`/properties/${result.data.id}/measure`);
    });
  };

  if (!canEdit) return null;

  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor="quick-property">Add a property</FieldLabel>
        <Input
          id="quick-property"
          value={address}
          placeholder="Start typing an address"
          autoComplete="street-address"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="quick-property-list"
          className="max-md:h-12"
          aria-invalid={error ? true : undefined}
          aria-expanded={suggestions.length > 0}
          onChange={(event) => {
            setAddress(event.target.value);
            setPicked(null);
            setSuggestions([]);
            setError(null);
          }}
        />
        <div id="quick-property-list" role="listbox" aria-label="Address suggestions" hidden={suggestions.length === 0} className="flex flex-col">
          {suggestions.map((suggestion) => (
            <Button
              key={suggestion.placeId ?? suggestion.formattedAddress}
              type="button"
              role="option"
              variant="ghost"
              className="min-h-11 justify-start"
              onClick={() => {
                setAddress(suggestion.formattedAddress);
                setPicked(suggestion);
                setSuggestions([]);
                setError(null);
              }}
            >
              {suggestion.formattedAddress}
            </Button>
          ))}
        </div>
        {error ? <FieldError>{error}</FieldError> : null}
      </Field>
      <Button type="submit" disabled={pending} className="min-h-11 lg:min-h-9">
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Add and measure
      </Button>
    </form>
  );
}
