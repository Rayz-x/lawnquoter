import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FieldHint } from "@/components/ui/field";
import { loadPortal } from "@/lib/portal/load";
import { requestService } from "./actions";

export const metadata: Metadata = { title: "Customer portal" };

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const portal = await loadPortal(token);
  if (!portal) notFound();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10">
      <header>
        <p className="text-sm text-muted-foreground">{portal.orgName}</p>
        <h1 className="font-heading text-3xl">{portal.accountName}</h1>
      </header>
      <section className="space-y-2">
        <h2 className="font-heading text-lg">Sites</h2>
        {portal.sites.map((site) => (
          <div key={site.id}>
            <p className="font-medium">{site.name}</p>
            {site.properties.length === 0 ? <p className="text-sm text-muted-foreground">No properties yet.</p> : null}
            {site.properties.map((property) => (
              <p key={property.id} className="text-sm text-muted-foreground">{property.label}</p>
            ))}
          </div>
        ))}
      </section>
      <section className="space-y-2">
        <h2 className="font-heading text-lg">Quotes</h2>
        {portal.quotes.length === 0 ? <p className="text-sm text-muted-foreground">No quotes to review.</p> : null}
        {portal.quotes.map((quote) => (
          <p key={quote.id} className="text-sm">
            <Link className="underline" href={quote.href}>{quote.label}</Link>
            <span className="text-muted-foreground"> · {quote.status === "accepted" ? "Signed" : quote.status === "sent" || quote.status === "viewed" || quote.status === "changed" ? "Sign" : quote.status}</span>
          </p>
        ))}
      </section>
      <section className="space-y-2">
        <h2 className="font-heading text-lg">Invoices</h2>
        {portal.invoices.length === 0 ? <p className="text-sm text-muted-foreground">No invoices to pay.</p> : null}
        {portal.invoices.map((invoice) => (
          <p key={invoice.id} className="text-sm">
            {invoice.href ? <Link className="underline" href={invoice.href}>{invoice.label}</Link> : invoice.label}
            <span className="text-muted-foreground"> · {invoice.href ? "Pay" : invoice.status}</span>
          </p>
        ))}
      </section>
      <section className="space-y-2">
        <h2 className="font-heading text-lg">Schedule</h2>
        {portal.visits.length === 0 ? <p className="text-sm text-muted-foreground">No upcoming visits.</p> : null}
        {portal.visits.map((visit) => (
          <p key={visit.id} className="text-sm">{visit.when} · {visit.label}</p>
        ))}
      </section>
      <section className="space-y-2">
        <h2 className="font-heading text-lg">Visit photos</h2>
        {portal.photos.length === 0 ? <p className="text-sm text-muted-foreground">No visit photos yet.</p> : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {portal.photos.map((photo) => (
            <a key={photo.id} href={photo.url}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={photo.kind} className="aspect-square w-full rounded-md object-cover" />
            </a>
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="font-heading text-lg">Card on file</h2>
        {portal.cardHref ? (
          <form action={portal.cardHref} method="post">
            <Button type="submit">Update card</Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">{portal.cardMessage}</p>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="font-heading text-lg">Request service</h2>
        <form action={requestService.bind(null, token)} className="grid gap-3">
          <div className="grid min-w-0 gap-1">
            <label htmlFor="portal-property" className="text-sm">Property</label>
            <select id="portal-property" name="property_id" aria-describedby="portal-property-hint" className="h-11 w-full rounded-md border bg-background px-2">
              <option value="">Any site</option>
              {portal.properties.map((property) => (
                <option key={property.id} value={property.id}>{property.label}</option>
              ))}
            </select>
            <FieldHint id="portal-property-hint">Which lawn this request is about, or any site.</FieldHint>
          </div>
          <div className="grid min-w-0 gap-1">
            <label htmlFor="portal-request" className="text-sm">Request</label>
            <textarea id="portal-request" name="body" required maxLength={2000} aria-describedby="portal-request-hint" placeholder="What should we do?" className="min-h-24 w-full rounded-md border p-2" />
            <FieldHint id="portal-request-hint">What you want done on the next visit.</FieldHint>
          </div>
          <Button type="submit" className="w-fit">Send request</Button>
        </form>
        {portal.requests.map((request) => (
          <p key={request.id} className="text-sm text-muted-foreground">{request.createdAt} · {request.body}</p>
        ))}
      </section>
    </main>
  );
}
