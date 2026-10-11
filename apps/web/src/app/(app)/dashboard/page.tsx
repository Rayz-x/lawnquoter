import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { requireOrg } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { AttentionQueue } from "./attention-queue";
import { loadToday, type TodayData } from "./load-today";
import { TodayToolbar } from "./today-toolbar";

export const metadata: Metadata = { title: "Today" };

function statusLabel(status: string, siteCheck: boolean) {
  if (siteCheck) return "Final price requested";
  return status.replaceAll("_", " ");
}

export function TodayScreen({ today }: { today: TodayData }) {
  const peak = Math.max(...today.week.map((bar) => bar.total), 1);
  const delta = today.acceptedWeek - today.acceptedPrior;
  const stopsRatio = today.stopsTotal === 0 ? 0 : Math.round((today.stopsDone / today.stopsTotal) * 100);

  return (
    <>
      <PageHeader title="Today" description={today.todayLabel} actions={<TodayToolbar />} />
      <div className="page-body">
        {today.error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load today</AlertTitle>
            <AlertDescription>{today.error}</AlertDescription>
          </Alert>
        ) : null}

        <section className="kpi-strip" aria-label="Today">
          <div>
            <p className="text-xs text-muted-foreground">Quotes out</p>
            <p className="num text-2xl font-semibold">{formatMoney(today.quotesOut)}</p>
            <p className="text-xs text-muted-foreground">{today.quotesOutCount} open</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Accepted this week</p>
            <p className="num text-2xl font-semibold">{formatMoney(today.acceptedWeek)}</p>
            <p className="text-xs text-success">
              {delta === 0 ? "Even with last week" : `${delta > 0 ? "+" : "−"}${formatMoney(Math.abs(delta))} vs last wk`}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Stops today</p>
            <p className="num text-2xl font-semibold">
              {today.stopsDone}/{today.stopsTotal}
            </p>
            <p className="text-xs text-muted-foreground">{stopsRatio}% done</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Needs attention</p>
            <p className="num text-2xl font-semibold">{today.attention.length}</p>
            <p className="text-xs text-warning">Requests and final prices</p>
          </div>
        </section>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <section id="needs-attention" className="overflow-clip rounded-xl border border-border bg-card">
              <header className="flex items-center justify-between gap-3 px-4 py-3">
                <h2 className="text-sm font-semibold">
                  Needs attention <span className="num text-muted-foreground">{today.attention.length}</span>
                </h2>
                <p className="text-xs text-muted-foreground">J/K to move · ↵ to open</p>
              </header>
              <AttentionQueue items={today.attention} />
            </section>

            <section className="overflow-clip rounded-xl border border-border bg-card">
              <header className="flex items-center justify-between gap-3 px-4 py-3">
                <h2 className="text-sm font-semibold">Quotes in motion</h2>
                <Link href="/quotes" className="text-xs underline-offset-4 hover:underline">
                  All quotes
                </Link>
              </header>
              {today.motion.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">No open quotes.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-start font-medium">No.</th>
                        <th className="px-2 py-2 text-start font-medium">Customer</th>
                        <th className="px-2 py-2 text-start font-medium">Work</th>
                        <th className="px-2 py-2 text-end font-medium">Total</th>
                        <th className="px-2 py-2 text-start font-medium">Status</th>
                        <th className="px-4 py-2 text-end font-medium">Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {today.motion.map((quote) => (
                        <tr key={quote.id} className="border-t border-border">
                          <td className="num px-4 py-2.5">#{quote.number}</td>
                          <td className="px-2 py-2.5">
                            <Link href={`/quotes/${quote.id}`} className="font-medium underline-offset-4 hover:underline">
                              {quote.customer}
                            </Link>
                            {quote.place ? <span className="block truncate text-xs text-muted-foreground">{quote.place}</span> : null}
                          </td>
                          <td className="px-2 py-2.5 text-muted-foreground">{quote.work}</td>
                          <td className="num px-2 py-2.5 text-end">{formatMoney(quote.total)}</td>
                          <td className="px-2 py-2.5">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs capitalize ${quote.siteCheck ? "bg-warning/15 text-warning" : "bg-success/15 text-success"}`}
                            >
                              {statusLabel(quote.status, quote.siteCheck)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-end text-muted-foreground">{quote.updated}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className="flex flex-col gap-4">
            <section className="rounded-xl border border-border bg-card p-4">
              <header className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Crews today</h2>
                <span className="num text-xs text-muted-foreground">
                  {today.stopsDone}/{today.stopsTotal}
                </span>
              </header>
              {today.crews.length === 0 ? (
                <p className="text-sm text-muted-foreground">No stops on the board today.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {today.crews.map((crew) => (
                    <li key={crew.name}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{crew.name}</span>
                        <span className="num text-xs text-muted-foreground">
                          {crew.done}/{crew.total}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-clip rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ inlineSize: `${crew.total === 0 ? 0 : Math.round((crew.done / crew.total) * 100)}%` }}
                        />
                      </div>
                      {crew.note ? <p className="mt-1 truncate text-xs text-muted-foreground">{crew.note}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">This week</p>
              <p className="num text-2xl font-semibold">{formatMoney(today.acceptedWeek)}</p>
              <p className="text-xs text-muted-foreground">Accepted</p>
              <div className="mt-4 flex h-24 items-end gap-1.5">
                {today.week.map((bar, index) => (
                  <div key={`${bar.label}-${index}`} className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex h-16 w-full items-end">
                      <div
                        className="w-full rounded-sm bg-primary"
                        style={{ blockSize: `${Math.max(8, Math.round((bar.total / peak) * 100))}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{bar.label}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

export default async function DashboardPage() {
  const session = await requireOrg();
  const today = await loadToday(session.orgId);
  return <TodayScreen today={today} />;
}
