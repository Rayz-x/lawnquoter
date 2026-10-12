"use client";

import { useState } from "react";
import { browserCrewStore, enqueueMutation, flushOutbox } from "@/lib/crew/queue";
import { invoiceForAcceptedQuote, mockImagerySqft, quoteFromMeasurement } from "@/lib/e2e/lead-flow";
import { Button } from "@/components/ui/button";

const VISIT_DATE = "2026-04-06";

export function E2eFlow() {
  const [lead, setLead] = useState<string | null>(null);
  const [turf, setTurf] = useState<number | null>(null);
  const [quote, setQuote] = useState<number | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [agreement, setAgreement] = useState(false);
  const [visit, setVisit] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [synced, setSynced] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const finishOffline = async () => {
    await enqueueMutation(browserCrewStore(), {
      client_id: crypto.randomUUID(),
      kind: "visit_finish",
      visit_id: "visit-1",
      user_id: "crew-1",
      org_id: "org-1",
      author_name: "Ada",
      payload: {},
    });
    setQueued(true);
  };

  const sync = async () => {
    setSyncError(null);
    if (!navigator.onLine) {
      setSyncError("Still offline.");
      return;
    }
    try {
      const result = await flushOutbox(
        browserCrewStore(),
        async (items) => items.map((item) => ({ client_id: item.client_id, status: "applied" as const, message: null })),
        { userId: "crew-1", orgId: "org-1" },
      );
      setSynced(result.sent > 0 && result.pending === 0);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Sync failed.");
    }
  };

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <h1 className="font-heading text-xl font-semibold">Fixture flow</h1>
      <p className="text-sm text-muted-foreground">Paid imagery and card charges stay mocked.</p>
      <Button type="button" disabled={lead !== null} onClick={() => setLead("Ada Lawn")}>Save lead</Button>
      {lead ? <p>Lead {lead}</p> : null}
      <Button type="button" disabled={!lead || turf !== null} onClick={() => setTurf(mockImagerySqft())}>Measure</Button>
      {turf !== null ? <p>{turf.toLocaleString("en-US")} sq ft. Imagery is mocked.</p> : null}
      <Button type="button" disabled={turf === null || quote !== null} onClick={() => setQuote(quoteFromMeasurement(turf ?? 0))}>Price quote</Button>
      {quote !== null ? <p>Quote ${quote.toFixed(2)}</p> : null}
      <Button type="button" disabled={quote === null || accepted} onClick={() => setAccepted(true)}>Accept quote</Button>
      {accepted ? <p>Accepted</p> : null}
      <Button type="button" disabled={!accepted || agreement} onClick={() => setAgreement(true)}>Create agreement</Button>
      {agreement ? <p>Agreement weekly mowing</p> : null}
      <Button type="button" disabled={!agreement || visit !== null} onClick={() => setVisit(VISIT_DATE)}>Schedule visit</Button>
      {visit ? <p>Visit {visit}</p> : null}
      <Button
        type="button"
        disabled={!visit || invoice !== null}
        onClick={() => {
          const bill = invoiceForAcceptedQuote(quote ?? 0);
          setInvoice(bill.charged ? "Charged" : `Invoice $${bill.invoiceDollars.toFixed(2)}. Not charged.`);
        }}
      >
        Create invoice
      </Button>
      {invoice ? <p>{invoice}</p> : null}
      <Button type="button" onClick={() => void finishOffline()}>Finish visit offline</Button>
      {queued ? <p>Waiting to sync</p> : null}
      <Button type="button" disabled={!queued} onClick={() => void sync()}>Sync</Button>
      {synced ? <p>Synced</p> : null}
      {syncError ? <p>{syncError}</p> : null}
    </main>
  );
}
