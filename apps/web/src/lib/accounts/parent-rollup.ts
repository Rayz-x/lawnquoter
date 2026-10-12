const OPEN_QUOTE = new Set(["draft", "sent", "viewed", "changed"]);

export type RollupAccount = { id: string; name: string };
export type RollupQuote = { account_id: string; status: string };
export type RollupInvoice = { account_id: string; status: string; total_cents: number };
export type RollupProperty = { id: string; account_id: string };
export type RollupJob = { property_id: string; status: string };

export type SiteRollup = {
  id: string;
  name: string;
  openQuotes: number;
  issuedCents: number;
  properties: number;
  jobs: number;
};

export type ParentRollupTotals = {
  sites: number;
  openQuotes: number;
  issuedCents: number;
  properties: number;
  jobs: number;
};

export type ParentRollup = {
  totals: ParentRollupTotals;
  sites: SiteRollup[];
};

export function rollupParentSites(input: {
  accounts: RollupAccount[];
  quotes: RollupQuote[];
  invoices: RollupInvoice[];
  properties: RollupProperty[];
  jobs: RollupJob[];
}): ParentRollup {
  const propertyAccount = new Map(input.properties.map((property) => [property.id, property.account_id]));
  const sites = input.accounts.map((account) => {
    const propertyIds = new Set(input.properties.filter((property) => property.account_id === account.id).map((property) => property.id));
    return {
      id: account.id,
      name: account.name,
      openQuotes: input.quotes.filter((quote) => quote.account_id === account.id && OPEN_QUOTE.has(quote.status)).length,
      issuedCents: input.invoices
        .filter((invoice) => invoice.account_id === account.id && invoice.status === "issued")
        .reduce((sum, invoice) => sum + invoice.total_cents, 0),
      properties: propertyIds.size,
      jobs: input.jobs.filter((job) => propertyAccount.get(job.property_id) === account.id && job.status !== "cancelled").length,
    };
  });
  const totals = sites.reduce<ParentRollupTotals>(
    (sum, site) => ({
      sites: sum.sites + 1,
      openQuotes: sum.openQuotes + site.openQuotes,
      issuedCents: sum.issuedCents + site.issuedCents,
      properties: sum.properties + site.properties,
      jobs: sum.jobs + site.jobs,
    }),
    { sites: 0, openQuotes: 0, issuedCents: 0, properties: 0, jobs: 0 },
  );
  return { totals, sites };
}
