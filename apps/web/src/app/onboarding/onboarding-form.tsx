"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CATALOG_SEED_V1 } from "@lawnquoter/pricing-engine";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/client";
import { slugify } from "@/lib/slug";
import { activateCatalogDraft, installCatalogServices } from "@/app/(app)/settings/pricing/catalog-actions";
import { inviteMember } from "@/app/(app)/settings/actions";
import { saveOnboarding } from "./actions";
import { WIZARD_STEPS, wizardServiceInstall, type WizardStep } from "./wizard";

const TITLES: Record<WizardStep, string> = {
  company: "Company",
  branding: "Branding",
  services: "Services",
  team: "Team",
  area: "Service area",
};

function isRedirect(caught: unknown): boolean {
  return typeof caught === "object" && caught !== null && "digest" in caught && String((caught as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT");
}

export function OnboardingWizard({ initialStep }: { initialStep: WizardStep }) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>(initialStep);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [color, setColor] = useState("#1E5235");
  const [selected, setSelected] = useState<string[]>(["weekly-mowing", "spring-cleanup"]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"crew" | "sales">("crew");
  const [zips, setZips] = useState("");
  const [draftListId, setDraftListId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const index = WIZARD_STEPS.indexOf(step);

  const run = (work: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await work();
      } catch (caught) {
        if (isRedirect(caught)) throw caught;
        setError(caught instanceof Error ? caught.message : "Something went wrong.");
      }
    });
  };

  const createCompany = () =>
    run(async () => {
      const supabase = createClient();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago";
      const { error: createError } = await supabase.rpc("create_org", { p_name: name.trim(), p_slug: slug, p_timezone: tz });
      if (createError) {
        setError(createError.code === "23505" ? "That URL handle is taken. Pick another." : createError.message);
        return;
      }
      await supabase.auth.refreshSession();
      router.refresh();
      setStep("branding");
    });

  const saveBrand = () =>
    run(async () => {
      const saved = await saveOnboarding({ step: "services", brandColor: color });
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      setStep("services");
    });

  const saveServices = (skip: boolean) =>
    run(async () => {
      let listId = draftListId;
      const picks = wizardServiceInstall(skip, selected);
      if (!listId && picks.length > 0) {
        const installed = await installCatalogServices(picks);
        if (!installed.ok) {
          setError(installed.error);
          return;
        }
        if (!installed.data.priceListId) {
          setError("Services were added to a draft and could not be turned on.");
          return;
        }
        listId = installed.data.priceListId;
        setDraftListId(listId);
      }
      if (listId) {
        const active = await activateCatalogDraft(listId);
        if (!active.ok) {
          setError(active.error);
          return;
        }
      }
      const saved = await saveOnboarding({ step: "team" });
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      setStep("team");
    });

  const saveTeam = (skip: boolean) =>
    run(async () => {
      if (!skip && email.trim()) {
        const fd = new FormData();
        fd.set("email", email.trim());
        fd.set("role", role);
        const invited = await inviteMember(fd);
        if (!invited.ok) {
          setError(invited.error);
          return;
        }
      }
      const saved = await saveOnboarding({ step: "area" });
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      setStep("area");
    });

  const finish = () =>
    run(async () => {
      const saved = await saveOnboarding({ serviceArea: zips, complete: true });
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Step {index + 1} of {WIZARD_STEPS.length} · {TITLES[step]}
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {step === "company" ? (
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            createCompany();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Company name</FieldLabel>
              <Input id="name" required aria-describedby="onboard-name-hint" className="w-full" value={name} onChange={(event) => { setName(event.target.value); if (!slugTouched) setSlug(slugify(event.target.value)); }} />
              <FieldHint id="onboard-name-hint">The name customers see on quotes and invoices.</FieldHint>
            </Field>
            <Field>
              <FieldLabel htmlFor="slug">URL handle</FieldLabel>
              <Input id="slug" required aria-describedby="onboard-slug-hint" pattern="[a-z0-9][a-z0-9-]{1,62}" className="w-full" value={slug} onChange={(event) => { setSlugTouched(true); setSlug(slugify(event.target.value)); }} />
              <FieldHint id="onboard-slug-hint">The short name in your public quote pages and instant-quote link.</FieldHint>
            </Field>
          </FieldGroup>
          <Button type="submit" disabled={pending || !name || slug.length < 2}>{pending ? <Spinner data-icon="inline-start" /> : null}Create company</Button>
        </form>
      ) : null}
      {step === "branding" ? (
        <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); saveBrand(); }}>
          <Field>
            <FieldLabel htmlFor="brand">Brand color</FieldLabel>
            <Input id="brand" aria-describedby="onboard-brand-hint" className="w-full" value={color} onChange={(event) => setColor(event.target.value)} />
            <FieldHint id="onboard-brand-hint">Buttons and headings on quotes use this color, such as #1E5235.</FieldHint>
          </Field>
          <Button type="submit" disabled={pending}>{pending ? <Spinner data-icon="inline-start" /> : null}Save color</Button>
        </form>
      ) : null}
      {step === "services" ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); saveServices(false); }}>
          <FieldHint id="onboard-services-hint">Uncheck any starter service you do not sell.</FieldHint>
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto" role="group" aria-describedby="onboard-services-hint">
            {CATALOG_SEED_V1.map((entry) => (
              <label key={entry.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(entry.key)}
                    onChange={(event) => setSelected((current) => event.target.checked ? [...current, entry.key] : current.filter((key) => key !== entry.key))}
                  />
                  {entry.name}
                </span>
                <span className="tabular-nums text-muted-foreground">${entry.starter.typical}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>{pending ? <Spinner data-icon="inline-start" /> : null}Add services</Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => saveServices(true)}>Skip</Button>
          </div>
        </form>
      ) : null}
      {step === "team" ? (
        <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); saveTeam(false); }}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="invite-email">Email</FieldLabel>
              <Input id="invite-email" type="email" aria-describedby="onboard-email-hint" className="w-full" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Optional" />
              <FieldHint id="onboard-email-hint">We email this person a link to join the company.</FieldHint>
            </Field>
            <Field>
              <FieldLabel htmlFor="invite-role">Role</FieldLabel>
              <select id="invite-role" aria-describedby="onboard-role-hint" className="native-control w-full" value={role} onChange={(event) => setRole(event.target.value === "sales" ? "sales" : "crew")}>
                <option value="crew">Crew</option>
                <option value="sales">Sales</option>
              </select>
              <FieldHint id="onboard-role-hint">Crew sees visits, and sales can write quotes.</FieldHint>
            </Field>
          </FieldGroup>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>{pending ? <Spinner data-icon="inline-start" /> : null}Send invite</Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => saveTeam(true)}>Skip</Button>
          </div>
        </form>
      ) : null}
      {step === "area" ? (
        <form className="flex flex-col gap-6" onSubmit={(event) => { event.preventDefault(); finish(); }}>
          <Field>
            <FieldLabel htmlFor="zips">ZIP codes you serve</FieldLabel>
            <textarea id="zips" aria-describedby="onboard-zips-hint" className="native-control min-h-24 w-full" value={zips} onChange={(event) => setZips(event.target.value)} placeholder="37064, 37067" />
            <FieldHint id="onboard-zips-hint">Leave this blank if you are not ready to limit the lead form.</FieldHint>
          </Field>
          <Button type="submit" disabled={pending}>{pending ? <Spinner data-icon="inline-start" /> : null}Finish setup</Button>
        </form>
      ) : null}
    </div>
  );
}
