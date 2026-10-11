## Agent skills

### Issue tracker

Issues and specs live as GitHub Issues in Rayz-x/lawnquoter. See `docs/agents/issue-tracker.md`.

### Triage labels

Default role labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context. Project docs live in `docs/`. See `docs/agents/domain.md`.

Skills in `.agents/skills/` are MIT-licensed. See `.agents/skills/LICENSE`.

## Repo rules

- Open pull requests as drafts.
- Author commits as `Rayz-x <242874303+Rayz-x@users.noreply.github.com>`.
- Keep UI pull requests under ~500 lines.
- Never merge, push to `main`, or apply Supabase migrations to the hosted database. Dusty approves every merge and hosted migration.

## Cursor Cloud

The Cloud Agent environment installs PostgreSQL 17 with PostGIS and pgTAP, the Supabase CLI, and `pnpm` dependencies. On boot it starts a local Supabase stack with the native runtime (no Docker), writes gitignored `apps/web/.env.local` from that stack, and runs `pnpm dev` at http://localhost:3000.

Open `localhost`, not `127.0.0.1`. Next.js dev resources do not hydrate client JavaScript from the IP address. The package Postgres cluster on port 5432 stays stopped; the app uses the Supabase database. `pnpm db:test` uses the PostgreSQL 17 binaries and its own throwaway cluster.

Do not apply migrations to the hosted Supabase project.

## Default workflow: Matt Pocock skills

Every agent working on lawnquoter uses these skills by default:

- Before building, use `grilling` when requirements are unclear, and `to-spec` when they are already clear. Clear tasks go to `to-spec` so `grilling` does not stall them.
- Use `to-tickets` for planning.
- Use `tdd` for implementation.
- Use `diagnosing-bugs` for bugs.
- Use `code-review` before committing.
- Use `pr` for pull request bodies.
- Skills such as `implement` commit to a feature branch and open a draft pull request. They never commit to `main`.
