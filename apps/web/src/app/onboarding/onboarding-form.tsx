"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/client";
import { slugify } from "@/lib/slug";

export function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onNameChange = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
      const { error } = await supabase.rpc("create_org", { p_name: name.trim(), p_slug: slug, p_timezone: tz });
      if (error) {
        setError(error.code === "23505" ? "That URL handle is taken. Pick another." : error.message);
        return;
      }
      // Re-mint the access token so the hook stamps org_id / org_role.
      await supabase.auth.refreshSession();
      router.replace("/dashboard");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="name">Company name</FieldLabel>
          <Input id="name" required value={name} onChange={(e) => onNameChange(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="slug">URL handle</FieldLabel>
          <Input
            id="slug"
            required
            pattern="[a-z0-9][a-z0-9-]{1,62}"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
          />
          <FieldDescription>Used for your public quote pages and the instant-quote widget.</FieldDescription>
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={pending || !name || slug.length < 2}>
        {pending ? <Spinner data-icon="inline-start" /> : null}
        Create workspace
      </Button>
    </form>
  );
}
