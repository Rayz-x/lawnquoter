# LawnQuoter

Lead-to-quote-to-job platform for residential and commercial lawn care and landscaping companies. Multi-tenant-ready from day one, running single-tenant for the owner company first.

Production: https://lawnquoter.vercel.app

- Product spec: `docs/superpowers/specs/2026-10-08-lawnquoter-platform-design.md`
- Market and technical research: `docs/research/`
- Brand notes: `docs/brand/BRAND.md`
- Change history: `CHANGELOG.md`

## What it does

Office staff keep accounts and properties, measure a lot on satellite imagery, price the work from the company catalog, and send a proposal. The customer opens a public link, reviews the included work and any options, and accepts with an electronic signature. When a price is a range, that acceptance is a not-to-exceed amount: the customer agrees to pay no more than the cap, and the final bill may be lower. A line flagged for a site check says the price will be confirmed on site within five days of acceptance, and the customer can request a final price from that page. A sealed copy of the signed proposal is emailed when email is configured. Each company can set its own logo, brand color, and heading style on the public page and the PDF. Every account includes billing details. The billing email stays blank until someone enters it, and the billing address starts as the first property.

An accepted quote becomes scheduled work. The office keeps agreements, names crews, assigns stops, and publishes the day. Recurring agreements stay filled about ten weeks ahead. The schedule lists stops that need attention, and a rain day can move that day's scheduled stops to the next work day. Crews install LawnQuoter on a phone and can keep working without a signal. The day's stops, a visit timer, before-and-after photos, skip reasons, and upsells stay on the phone until they send. The crew map shows today's stop pins, or an outline map with no satellite tiles when battery saver is on. Gate codes are shown for yesterday, today, and tomorrow on the company clock.

Property addresses are geocoded with Esri and stored on the property. Maps that draw that pin credit Esri.

The office picks a lead source on the account. Lead sources, in the Sales menu, shows how fast leads are first contacted and how often each source becomes a customer. A lead page lets the office log a contact, assign it, and set a follow-up. The menu does not list every lead. When email is configured, people with follow-ups due get one morning email. The company owner can connect the company's Stripe account from Settings. Accepting a quote records the signature and does not charge a card. When an invoice is issued, it gets the next number for the year and the tax and total stay locked. There is no screen to open or issue an invoice. The dashboard figures are placeholders. Bids and analytics are not in the menu.

## Stack

Next.js (App Router) + Supabase (Postgres 17, PostGIS, Auth, Storage) + shadcn/ui + Vercel. Monorepo managed with pnpm (`pnpm-workspace.yaml` includes `apps/*` and `packages/*`).

```
apps/web                 Office web app, public quote pages, crew PWA, API routes
packages/shared          Zod schemas and types shared across apps
packages/pricing-engine  Pure TypeScript pricing engine
supabase/migrations      Schema, RLS policies, RPCs
supabase/tests           pgTAP tests (tenant isolation, role gating)
scripts/                 Local database tests and TypeScript type generation
docs/                    Product spec, research, and brand notes
.github/workflows        Continuous integration (app checks and database tests)
```

## Local development

Requirements: Node 22+, pnpm 12+, PostgreSQL 17 with PostGIS and pgTAP (Homebrew: `brew install postgresql@17 postgis`, then build pgTAP from source), Supabase CLI.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in your Supabase project keys
pnpm db:test        # boots a throwaway Postgres, applies migrations, runs pgTAP
pnpm db:types       # regenerates apps/web/src/lib/supabase/database.types.ts
pnpm dev            # http://localhost:3000
```

Also available: `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

### Environment

Required in `apps/web/.env.local` (see `apps/web/.env.example`):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_APP_URL` — public origin, used in invite and magic-link redirects. An empty value falls back to localhost.

Optional:

- `ARCGIS_API_KEY` — server-only key for stored Esri geocoding. It needs the geocode (stored) privilege.
- `NEXT_PUBLIC_ARCGIS_API_KEY` — public browser key for Esri World Imagery tiles. It is not used for geocoding.
- `REGRID_API_TOKEN` — parcel lookup while measuring. Without it, the lot is traced by hand.
- `RESEND_API_KEY` and `EMAIL_FROM` — email the sealed acceptance copy, and the morning follow-up list. Leave both unset to skip sending.
- `CRON_SECRET` — shared secret for the hourly follow-up job (`Authorization: Bearer`). Leave unset and that job refuses the request. The job still needs the email keys above before it sends.
- `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` — Stripe Connect. The company owner connects an Express account from the Payments section of Settings. Owners and admins can save a card on file from an account once Connect is ready. Leave the keys unset and that screen says to add a Stripe key. Click-to-accept does not charge a card, and it works with these unset. A quote deposit is collected in Stripe Checkout only when the keys are set and Connect is ready. The instant-quote widget shows its range without them; the optional deposit stays off and the widget says to add a Stripe key.
- `STRIPE_BILLING_ENABLED`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, and `STRIPE_PRICE_SCALE` — LawnQuoter's own flat monthly plan (Starter, Growth, Scale). Off unless `STRIPE_BILLING_ENABLED=1` and `STRIPE_SECRET_KEY` is an `sk_test_` key. A live key is refused. Leave them unset and Settings says to add a Stripe key.
- `SIGNWELL_API_KEY` — SignWell for commercial contracts. Leave unset and the quote shows "Not connected - add a SignWell key to enable." When set, sending a commercial contract creates a SignWell document in test mode and stores its id. Residential quotes are unchanged.
- `E2E_MODE` — set to `1` only for the Playwright fixture at `/e2e`. It is ignored when `VERCEL_ENV=production`. Leave it unset in every deployed environment.
- `WISETACK_PREQUAL_URL` — public financing link. Leave unset and Settings says it is not connected. When set, a proposal of $500 or more shows "See financing options". No Wisetack API call is made.
- `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` — QuickBooks Online two-way sync. Leave either unset and Settings says it is not connected. Child accounts sync as sub-customers. The sync log and conflict choices are at Settings → QuickBooks.
- `AI_QUOTE_API_KEY` and `AI_QUOTE_API_URL` — optional AI draft on a quote. Both must be set before any request is sent. With either one missing, the quote still drafts from similar accepted quotes nearby and the page says the provider is not connected.
- Lead connectors stay off until their keys are set. The settings page says which key. `GOOGLE_LSA_WEBHOOK_SECRET`, `THUMBTACK_WEBHOOK_SECRET`, `YELP_WEBHOOK_SECRET`, `ANGI_WEBHOOK_SECRET`, and `INBOUND_LEAD_WEBHOOK_SECRET` (Zapier) authorize `POST /api/public/leads/inbound/{connector}` with `Authorization: Bearer`. Facebook Lead Ads also needs `FACEBOOK_LEAD_ADS_VERIFY_TOKEN`, `FACEBOOK_APP_SECRET`, `FACEBOOK_PAGE_ACCESS_TOKEN`, and `INBOUND_LEAD_ORG_SLUG`. Leave them unset and those routes refuse the request.
- `NEARMAP_API_KEY`, `VEXCEL_API_KEY`, and `SEGMENTATION_API_KEY` — HD imagery and one-click segmentation on the measure screen. Leave them unset. The screen then says to add that key. Tracing on Esri does not need them, and this build does not call those services.
- `SITEONE_API_KEY` and `HOME_DEPOT_API_KEY` — supplier price lookup on Services & Pricing. Leave both unset. The materials sheet then says to add that key. Spreadsheet import does not need them, and this build does not call either catalog.

## Connecting a Supabase project

1. Create a project at supabase.com and run `supabase link --project-ref <ref>`.
2. `supabase db push` applies `supabase/migrations`.
3. In the dashboard, enable Auth > Hooks > Customize Access Token and point it at `public.custom_access_token_hook` (the CLI config in `supabase/config.toml` does this for local/linked projects).
4. Put the project URL, publishable key and secret key in `apps/web/.env.local`.
5. Sign up, then visit `/onboarding` to create your company workspace.

## Tenancy model

Every table carries `org_id`. RLS is enabled and forced everywhere; policies call `private.is_org_member()` / `private.has_org_role()`, which check both the JWT's `app_metadata.org_id` and a live `memberships` row so disabled users lose access immediately. Public quote pages use signed-token RPCs rather than the anon role.
