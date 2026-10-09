"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { contrast, deriveBrandTheme, normalizeHex } from "@/lib/brand/derive-brand-theme";
import { logoShowsName } from "@/lib/brand/initials";
import { headingFontOf, type HeadingFont, type PublicOrg } from "@/lib/brand/public-org";
import { brandingAssetUrl } from "@/lib/brand/urls";
import { brandWarningCopy } from "@/lib/brand/warnings";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { Tables } from "@/lib/supabase/types";
import { ProposalView } from "@/app/q/[token]/proposal-view";
import { saveBranding } from "./branding-actions";
import { SAMPLE_QUOTE_ITEMS } from "./sample-quote";

const PRESETS = ["#1E5235", "#1D5FAF", "#0F766E", "#A4262C", "#C62828", "#F7D84A", "#E07A1F", "#334155"];

const LIGHT_SURFACE = {
  "--background": "#FFFFFF",
  "--foreground": "#121A16",
  "--card": "#FFFFFF",
  "--card-foreground": "#121A16",
  "--muted": "#F4F6F4",
  "--muted-foreground": "#56625B",
  "--border": "#D9E0DB",
  "--input": "#88948E",
} as const;

const DARK_SURFACE = {
  "--background": "#0D1310",
  "--foreground": "#EBF1ED",
  "--card": "#151E19",
  "--card-foreground": "#EBF1ED",
  "--muted": "#1A241F",
  "--muted-foreground": "#9AA79F",
  "--border": "#2A3530",
  "--input": "#5F6D66",
} as const;

function fileMeta(file: File | null) {
  if (!file) return null;
  return `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
}

export function BrandingForm({ org, canEdit }: { org: Tables<"orgs">; canEdit: boolean }) {
  const [color, setColor] = useState(org.brand_color ?? "#1E5235");
  const [heading, setHeading] = useState<HeadingFont>(headingFontOf(org.heading_font));
  const [showName, setShowName] = useState<"auto" | "on" | "off">(
    org.logo_shows_name == null ? "auto" : org.logo_shows_name ? "on" : "off",
  );
  const [chip, setChip] = useState(org.logo_needs_chip);
  const [chipTouched, setChipTouched] = useState(false);
  const [lightFile, setLightFile] = useState<File | null>(null);
  const [darkFile, setDarkFile] = useState<File | null>(null);
  const [removeLight, setRemoveLight] = useState(false);
  const [removeDark, setRemoveDark] = useState(false);
  const [lightUrl, setLightUrl] = useState<string | null>(brandingAssetUrl(org.logo_path));
  const [darkUrl, setDarkUrl] = useState<string | null>(brandingAssetUrl(org.logo_dark_path));
  const [error, setError] = useState<string | null>(null);
  const [segment, setSegment] = useState<"light" | "dark" | "pdf">("light");
  const [pending, startTransition] = useTransition();

  const theme = useMemo(() => deriveBrandTheme(color), [color]);
  const warning = brandWarningCopy(theme);
  const normalized = normalizeHex(color);

  const previewOrg: PublicOrg = {
    name: org.name,
    phone: org.phone,
    email: org.email,
    website: org.website,
    brand_color: normalized,
    logo_url: removeLight ? null : lightUrl,
    logo_dark_url: removeDark ? null : darkUrl,
    logo_raster_url: null,
    logo_width: org.logo_width,
    logo_height: org.logo_height,
    logo_shows_name: showName === "auto" ? null : showName === "on",
    logo_needs_chip: chip,
    heading_font: heading,
    address_line1: org.address_line1,
    city: org.city,
    region: org.region,
    postal_code: org.postal_code,
  };

  const onLight = (file: File | null) => {
    setError(null);
    setLightFile(file);
    setRemoveLight(false);
    if (lightUrl?.startsWith("blob:")) URL.revokeObjectURL(lightUrl);
    setLightUrl(file ? URL.createObjectURL(file) : brandingAssetUrl(org.logo_path));
    if (!file) setChipTouched(false);
  };

  const reset = () => {
    setColor(org.brand_color ?? "#1E5235");
    setHeading(headingFontOf(org.heading_font));
    setShowName(org.logo_shows_name == null ? "auto" : org.logo_shows_name ? "on" : "off");
    setChip(org.logo_needs_chip);
    setChipTouched(false);
    setLightFile(null);
    setDarkFile(null);
    setRemoveLight(false);
    setRemoveDark(false);
    setLightUrl(brandingAssetUrl(org.logo_path));
    setDarkUrl(brandingAssetUrl(org.logo_dark_path));
    setError(null);
  };

  const save = () => {
    const fd = new FormData();
    fd.set("brand_color", normalized ?? color);
    fd.set("heading_font", heading);
    fd.set("logo_shows_name", showName);
    if (chipTouched) fd.set("logo_needs_chip", chip ? "true" : "false");
    if (lightFile) fd.set("logo_light", lightFile);
    if (darkFile) fd.set("logo_dark", darkFile);
    if (removeLight) fd.set("remove_light", "true");
    if (removeDark) fd.set("remove_dark", "true");
    startTransition(async () => {
      const result = await saveBranding(fd);
      if (result.ok) {
        toast.success("Branding saved");
        setError(null);
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
  };

  const samplePdf = `/settings/branding/sample-pdf?color=${encodeURIComponent(normalized ?? "")}&heading=${heading}`;
  const nameMode = logoShowsName({
    logo_url: previewOrg.logo_url,
    logo_shows_name: previewOrg.logo_shows_name,
    logo_width: previewOrg.logo_width,
    logo_height: previewOrg.logo_height,
  });

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <fieldset disabled={!canEdit || pending} className="m-0 grid min-w-0 gap-4 border-0 p-0 disabled:opacity-80">
        {!canEdit ? <p className="text-sm text-muted-foreground">Only owners and admins can change branding. You can still preview it.</p> : null}
        <section className="rounded-xl border p-4">
          <h2 className="font-medium">Logo</h2>
          <p className="mt-1 text-sm text-muted-foreground">SVG, PNG, or JPEG. 2 MB max. SVG is cleaned on the server.</p>
          <label className="mt-3 grid cursor-pointer gap-2 rounded-lg border border-dashed p-4 [background-image:linear-gradient(45deg,#00000010_25%,transparent_25%),linear-gradient(-45deg,#00000010_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#00000010_75%),linear-gradient(-45deg,transparent_75%,#00000010_75%)] [background-position:0_0,0_8px,8px_-8px,-8px_0] [background-size:16px_16px]">
            {lightUrl && !removeLight ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lightUrl} alt="" className="h-12 w-auto max-w-[220px] object-contain object-left" />
            ) : (
              <span className="text-sm text-muted-foreground">Drop a logo, or click to choose one</span>
            )}
            <input
              type="file"
              accept="image/svg+xml,image/png,image/jpeg"
              className="sr-only"
              onChange={(event) => onLight(event.target.files?.[0] ?? null)}
            />
            <span className="text-xs text-muted-foreground">{fileMeta(lightFile) ?? (org.logo_path && !removeLight ? "Current logo" : "No logo yet")}</span>
          </label>
          {lightUrl && !removeLight ? (
            <Button type="button" variant="outline" className="mt-2" onClick={() => { onLight(null); setRemoveLight(true); setLightUrl(null); }}>
              Remove
            </Button>
          ) : null}
          {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}

          <h3 className="mt-5 text-sm font-medium">Logo for dark backgrounds</h3>
          <label className="mt-2 grid cursor-pointer gap-2 rounded-lg border border-dashed bg-card p-4">
            {darkUrl && !removeDark ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={darkUrl} alt="" className="h-12 w-auto max-w-[220px] object-contain object-left" />
            ) : (
              <span className="rounded-md border bg-white p-2 text-sm text-muted-foreground">
                No dark logo yet. Dark mode uses the main logo{chip ? " on a white chip" : ""}.
              </span>
            )}
            <input
              type="file"
              accept="image/svg+xml,image/png,image/jpeg"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setDarkFile(file);
                setRemoveDark(false);
                if (darkUrl?.startsWith("blob:")) URL.revokeObjectURL(darkUrl);
                setDarkUrl(file ? URL.createObjectURL(file) : brandingAssetUrl(org.logo_dark_path));
              }}
            />
          </label>
          {darkUrl && !removeDark ? (
            <Button type="button" variant="outline" className="mt-2" onClick={() => { setDarkFile(null); setRemoveDark(true); setDarkUrl(null); }}>
              Remove dark logo
            </Button>
          ) : null}

          <Field className="mt-4">
            <FieldLabel htmlFor="show-name">Show company name next to the logo</FieldLabel>
            <select
              id="show-name"
              className="native-control"
              value={showName}
              onChange={(event) => setShowName(event.target.value as "auto" | "on" | "off")}
            >
              <option value="auto">Auto — {nameMode ? "show the name" : "hide the name"} for this logo</option>
              <option value="on">Always show</option>
              <option value="off">Hide</option>
            </select>
          </Field>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={chip}
              onChange={(event) => {
                setChip(event.target.checked);
                setChipTouched(true);
              }}
            />
            Put the logo on a white chip in dark mode when there is no dark logo
          </label>
        </section>

        <section className="rounded-xl border p-4">
          <h2 className="font-medium">Brand color</h2>
          <div className="mt-3 flex items-center gap-3">
            <input
              type="color"
              aria-label="Brand color"
              value={normalized ?? "#1E5235"}
              onChange={(event) => setColor(event.target.value.toUpperCase())}
              className="size-10 cursor-pointer rounded-md border bg-transparent"
            />
            <Input value={color} onChange={(event) => setColor(event.target.value)} onBlur={() => normalized && setColor(normalized)} className="max-w-[140px] font-mono" spellCheck={false} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS.map((hex) => (
              <button key={hex} type="button" aria-label={hex} className="size-7 rounded-md border" style={{ background: hex }} onClick={() => setColor(hex)} />
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Shade title="Light buttons" fill={theme.light.fill} ink={theme.light.foreground} />
            <Shade title="Light text" fill="#FFFFFF" ink={theme.light.text} />
            <Shade title="Dark buttons" fill={theme.dark.fill} ink={theme.dark.foreground} />
            <Shade title="Dark text" fill="#0D1310" ink={theme.dark.text} />
          </div>
          {warning ? <p className="mt-3 text-sm text-muted-foreground">{warning}</p> : null}
        </section>

        <section className="rounded-xl border p-4">
          <h2 className="font-medium">Heading style</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {(
              [
                ["classic", "Classic", "font-heading"],
                ["clean", "Clean", "font-sans"],
                ["sturdy", "Sturdy", "[font-family:var(--font-heading-sturdy),Georgia,serif]"],
              ] as const
            ).map(([value, label, font]) => (
              <label key={value} className="cursor-pointer rounded-lg border p-3 has-[:checked]:border-primary">
                <input type="radio" name="heading-preview" className="sr-only" checked={heading === value} onChange={() => setHeading(value)} />
                <span className="block text-xs text-muted-foreground">{label}</span>
                <span className={`mt-1 block text-lg ${font}`}>Aa $1,601</span>
              </label>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Powered by LawnQuoter always shows on quotes and PDFs.</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={reset}>
              Reset
            </Button>
            <Button type="button" onClick={save} disabled={!canEdit || pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Save branding
            </Button>
          </div>
        </div>
      </fieldset>

      <aside className="xl:sticky xl:top-20">
        <div className="rounded-xl border p-3">
          <div className="mb-3 flex gap-1 rounded-lg bg-muted p-1 text-xs">
            {(
              [
                ["light", "Quote page · Light"],
                ["dark", "Quote page · Dark"],
                ["pdf", "PDF"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`flex-1 rounded-md px-2 py-1 ${segment === value ? "bg-background text-foreground" : "text-muted-foreground"}`}
                onClick={() => setSegment(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {segment === "pdf" ? (
            <PdfFrame org={previewOrg} themeFill={theme.light.fill} themeText={theme.light.text} themeSoft={theme.light.soft} onFill={theme.light.foreground} />
          ) : (
            <div
              data-tenant-brand
              data-heading={heading}
              className={`max-h-[720px] overflow-auto rounded-lg border ${segment === "dark" ? "dark" : ""}`}
              style={{ ...(segment === "dark" ? DARK_SURFACE : LIGHT_SURFACE), ...cssVars(theme, segment) } as React.CSSProperties}
            >
              <ProposalView
                token="preview"
                payload={{
                  title: "Weekly maintenance",
                  number: 1042,
                  intro: "A season of mowing, edging, and beds.",
                  notes_customer: "Gate code 1908.",
                  expires_at: null,
                  status: "sent",
                  org: previewOrg,
                  items: SAMPLE_QUOTE_ITEMS,
                }}
              />
            </div>
          )}
          <a className="mt-3 inline-block text-sm text-primary underline" href={samplePdf} target="_blank" rel="noopener">
            Open sample PDF
          </a>
        </div>
      </aside>
    </div>
  );
}

function cssVars(theme: ReturnType<typeof deriveBrandTheme>, mode: "light" | "dark") {
  const shades = theme[mode];
  return {
    "--primary": shades.fill,
    "--primary-foreground": shades.foreground,
    "--ring": shades.edge,
    "--brand-text": shades.text,
    "--brand-edge": shades.edge,
    "--brand-soft": shades.soft,
  } as const;
}

function Shade({ title, fill, ink }: { title: string; fill: string; ink: string }) {
  const ratio = contrast(ink, fill);
  return (
    <div className="rounded-md border p-2">
      <div className="text-muted-foreground">{title}</div>
      <div className="mt-1 flex items-center justify-between rounded px-2 py-1 font-mono" style={{ background: fill, color: ink }}>
        <span>{ink}</span>
        <span>{ratio.toFixed(2)}:1 ✓</span>
      </div>
    </div>
  );
}

function PdfFrame({
  org,
  themeFill,
  themeText,
  themeSoft,
  onFill,
}: {
  org: PublicOrg;
  themeFill: string;
  themeText: string;
  themeSoft: string;
  onFill: string;
}) {
  return (
    <div className="rounded-lg border bg-white p-4 text-[#121A16]">
      <div className="flex items-start justify-between gap-3 text-xs">
        <strong style={{ color: themeText }}>{org.name}</strong>
        <span className="text-right text-[#56625B]">{org.phone}</span>
      </div>
      <div className="mt-2 h-0.5" style={{ background: themeFill }} />
      <h3 className="mt-3 font-heading text-lg">Weekly maintenance</h3>
      <p className="text-[10px] text-[#56625B]">Quote #1042</p>
      <div className="mt-3 flex justify-between text-sm">
        <span>Standard</span>
        <span className="font-heading">$1,601</span>
      </div>
      <p className="mt-3 font-heading text-base" style={{ color: themeText }}>
        Total $1,601.00
      </p>
      <div className="mt-3 rounded-md p-2 text-xs" style={{ background: themeSoft }}>
        <div>Review and accept online</div>
        <span className="mt-1 inline-block rounded px-2 py-1" style={{ background: themeFill, color: onFill }}>
          Accept online →
        </span>
      </div>
    </div>
  );
}
