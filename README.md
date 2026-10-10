# LawnQuoter

Lead-to-quote-to-job platform for residential and commercial lawn care and landscaping companies. Multi-tenant-ready from day one, running single-tenant for the owner company first.

- Product spec: `docs/superpowers/specs/2026-10-08-lawnquoter-platform-design.md`
- Market and technical research: `docs/research/`
- Brand notes: `docs/brand/BRAND.md`
- Change history: `CHANGELOG.md`

## What it does

Office staff keep accounts and properties, measure a lot on satellite imagery, price the work from the company catalog, and send a proposal. The customer opens a public link, reviews the included work and any options, and accepts with an electronic signature. When a price is a range, that acceptance is a not-to-exceed amount: the customer agrees to pay no more than the cap, and the final bill may be lower. A sealed copy of the signed proposal is emailed when email is configured. Each company can set its own logo, brand color, and heading style on the public page and the PDF.

An accepted quote becomes scheduled work. The office keeps agreements, names crews, assigns stops, and publishes the day. Crews install LawnQuoter on a phone and can keep working without a signal. The day's stops, a visit timer, before-and-after photos, skip reasons, and upsells stay on the phone until they send.

Property addresses are geocoded with Esri and stored on the property. Maps that draw that pin credit Esri.

Leads, bids, invoices, and analytics appear in the office navigation and do not have screens yet. The dashboard figures are placeholders. The Payments tab does not charge cards; click-to-accept records the signature without it. The crew Map tab does not show a map.

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
bash scripts/db-types.sh   # regenerates apps/web/src/lib/supabase/database.types.ts
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
- `RESEND_API_KEY` and `EMAIL_FROM` — email the sealed acceptance copy. Leave both unset to skip sending.
- Stripe and SignWell keys are listed for later card payments and formal contracts. Click-to-accept works without them.

## Connecting a Supabase project

1. Create a project at supabase.com and run `supabase link --project-ref <ref>`.
2. `supabase db push` applies `supabase/migrations`.
3. In the dashboard, enable Auth > Hooks > Customize Access Token and point it at `public.custom_access_token_hook` (the CLI config in `supabase/config.toml` does this for local/linked projects).
4. Put the project URL, publishable key and secret key in `apps/web/.env.local`.
5. Sign up, then visit `/onboarding` to create your company workspace.

## Tenancy model

Every table carries `org_id`. RLS is enabled and forced everywhere; policies call `private.is_org_member()` / `private.has_org_role()`, which check both the JWT's `app_metadata.org_id` and a live `memberships` row so disabled users lose access immediately. Public quote pages use signed-token RPCs rather than the anon role.
