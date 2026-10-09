# LawnQuoter

Lead-to-quote-to-job platform for residential and commercial lawn care and landscaping companies. Multi-tenant-ready from day one, running single-tenant for the owner company first.

- Product spec: `docs/superpowers/specs/2026-10-08-lawnquoter-platform-design.md`
- Market and technical research: `docs/research/`

## Stack

Next.js (App Router) + Supabase (Postgres 17, PostGIS, Auth, Storage) + shadcn/ui + Vercel. Monorepo managed with pnpm.

```
apps/web                 Office web app, public quote pages, crew PWA, API routes
packages/shared          Zod schemas and types shared across apps
packages/pricing-engine  Pure TypeScript pricing engine (Step 4)
supabase/migrations      Schema, RLS policies, RPCs
supabase/tests           pgTAP tests (tenant isolation, role gating)
scripts/                 Local DB test + type generation
```

## Local development

Requirements: Node 22+, pnpm 12+, PostgreSQL 17 with PostGIS and pgTAP (Homebrew: `brew install postgresql@17 postgis`, then build pgTAP from source), Supabase CLI.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in your Supabase project keys
pnpm db:test        # boots a throwaway Postgres, applies migrations, runs pgTAP
bash scripts/db-types.sh   # regenerates apps/web/src/lib/supabase/database.types.ts
pnpm dev
```

## Connecting a Supabase project

1. Create a project at supabase.com and run `supabase link --project-ref <ref>`.
2. `supabase db push` applies `supabase/migrations`.
3. In the dashboard, enable Auth > Hooks > Customize Access Token and point it at `public.custom_access_token_hook` (the CLI config in `supabase/config.toml` does this for local/linked projects).
4. Put the project URL, publishable key and secret key in `apps/web/.env.local`.
5. Sign up, then visit `/onboarding` to create your company workspace.

## Tenancy model

Every table carries `org_id`. RLS is enabled and forced everywhere; policies call `private.is_org_member()` / `private.has_org_role()`, which check both the JWT's `app_metadata.org_id` and a live `memberships` row so disabled users lose access immediately. Public quote pages and the widget use signed-token RPCs rather than the anon role.
