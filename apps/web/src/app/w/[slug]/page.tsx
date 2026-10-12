import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadInstantQuotePage } from "@/lib/leads/load-public-form";
import { utmFromSearchParams } from "@/lib/leads/public-form-payload";
import { InstantQuoteWidget } from "./instant-quote-widget";
import { instantQuoteDepositAvailable } from "./start-deposit";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const org = await loadInstantQuotePage(slug);
  return { title: org ? `Instant quote — ${org.orgName}` : "Instant quote" };
}

export default async function InstantQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const org = await loadInstantQuotePage(slug);
  if (!org) notFound();
  const query = await searchParams;
  const utm = utmFromSearchParams(
    new URLSearchParams(Object.entries(query).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : []))),
  );

  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground">
      <div className="mx-auto grid w-full max-w-md gap-6">
        <header className="grid gap-2">
          <p className="text-sm font-medium text-muted-foreground">Instant quote</p>
          <h1 className="text-3xl font-semibold tracking-tight">{org.orgName}</h1>
        </header>
        <InstantQuoteWidget
          slug={org.slug}
          services={org.services}
          serviceAreaZips={org.config.serviceAreaZips}
          initialUtm={utm}
          depositConnected={await instantQuoteDepositAvailable(org.orgId)}
          depositPaid={query.deposit === "paid"}
          turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null}
        />
      </div>
    </main>
  );
}
