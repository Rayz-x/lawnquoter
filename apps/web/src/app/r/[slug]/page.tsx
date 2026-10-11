import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicLeadForm } from "@/lib/leads/load-public-form";
import { RequestQuoteForm } from "./request-quote-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const org = await loadPublicLeadForm(slug);
  return { title: org ? `Request a quote — ${org.orgName}` : "Request a quote" };
}

export default async function HostedQuoteRequestPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const org = await loadPublicLeadForm(slug);
  if (!org) notFound();

  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;

  return (
    <main className="min-h-dvh bg-background px-4 py-8 text-foreground">
      <div className="mx-auto w-full max-w-md">
        <header className="mb-6 grid gap-2">
          <p className="text-sm font-medium text-muted-foreground">Request a quote</p>
          <h1 className="text-3xl font-semibold tracking-tight">{org.orgName}</h1>
          <p className="text-muted-foreground">Tell us about your property. We will follow up with a quote.</p>
        </header>

        <RequestQuoteForm
          slug={org.slug}
          orgName={org.orgName}
          services={org.services}
          consentText={org.consentText}
          responseTargetMinutes={org.responseTargetMinutes}
          turnstileSiteKey={turnstileSiteKey}
        />

        <section id="privacy-notice" className="mt-10 border-t pt-6 text-sm text-muted-foreground">
          <h2 className="mb-2 font-medium text-foreground">Privacy notice</h2>
          <p>
            We use the details you submit only to respond to this quote request. SMS consent is optional
            and separate from submitting.
          </p>
        </section>
      </div>
    </main>
  );
}
