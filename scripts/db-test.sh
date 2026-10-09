#!/usr/bin/env bash
# Spin up a throwaway Postgres cluster (or use $DATABASE_URL if set), apply the
# Supabase shim + all migrations, then run every pgTAP test in supabase/tests.
#
# Usage:
#   pnpm db:test                 # ephemeral local cluster (needs postgresql@17 + postgis + pgtap)
#   DATABASE_URL=postgres://... pnpm db:test   # run against an existing database (CI)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
TESTS_DIR="$ROOT/supabase/tests"

PG_BIN="${PG_BIN:-}"
if [[ -z "$PG_BIN" ]]; then
  for candidate in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin; do
    if [[ -x "$candidate/psql" ]]; then PG_BIN="$candidate"; break; fi
  done
fi
if [[ -z "$PG_BIN" ]] && command -v psql >/dev/null 2>&1; then
  PG_BIN="$(dirname "$(command -v psql)")"
fi
if [[ -z "$PG_BIN" ]]; then
  echo "psql not found; install postgresql@17 or set PG_BIN" >&2
  exit 1
fi
export PATH="$PG_BIN:$PATH"

cleanup() {
  if [[ -n "${PGDATA_TMP:-}" ]]; then
    pg_ctl -D "$PGDATA_TMP" stop -m immediate >/dev/null 2>&1 || true
    rm -rf "$PGDATA_TMP"
  fi
}
trap cleanup EXIT

if [[ -z "${DATABASE_URL:-}" ]]; then
  PGDATA_TMP="$(mktemp -d /tmp/lawnquoter-pg.XXXXXX)"
  PORT="${PGPORT_TEST:-54329}"
  initdb -D "$PGDATA_TMP" -U postgres --auth=trust >/dev/null
  pg_ctl -D "$PGDATA_TMP" -o "-p $PORT -k $PGDATA_TMP -c listen_addresses=127.0.0.1" -l "$PGDATA_TMP/server.log" start >/dev/null
  DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/lawnquoter_test"
  psql "postgres://postgres@127.0.0.1:$PORT/postgres" -q -c "create database lawnquoter_test;" >/dev/null
fi

export DATABASE_URL
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)

echo "==> applying shim"
"${PSQL[@]}" -c "create extension if not exists pgcrypto;" >/dev/null
for f in "$TESTS_DIR"/_shim/*.sql; do
  # helpers reference public.org_role, so only the base shim runs before migrations
  if [[ "$(basename "$f")" == 00_* ]]; then
    "${PSQL[@]}" -f "$f" >/dev/null
  fi
done
"${PSQL[@]}" -c "alter database lawnquoter_test set search_path = public, extensions;" >/dev/null 2>&1 || true

# Hosted Supabase owns storage.objects as supabase_storage_admin (RLS already
# on). postgres is not that owner, so ALTER TABLE ... ENABLE/FORCE ROW LEVEL
# SECURITY fails with "must be owner". supautils.policy_grants still lets the
# migration role create policies. When that GUC exists, run storage DDL as
# nosuperuser hosted_migrator. Vanilla Postgres has no supautils; the shim's
# event trigger rejects the same ALTER instead.
HOSTED_MIGRATOR=0
POLICY_GRANTS="$("${PSQL[@]}" -tAc "select current_setting('supautils.policy_grants', true)")"
if [[ -n "$POLICY_GRANTS" ]]; then
  echo "==> applying storage DDL as non-superuser hosted_migrator"
  NEW_GRANTS="$(POLICY_GRANTS="$POLICY_GRANTS" python3 -c '
import json, os
grants = json.loads(os.environ["POLICY_GRANTS"])
tables = set(grants.get("hosted_migrator", []))
tables.update(["storage.buckets", "storage.objects"])
grants["hosted_migrator"] = sorted(tables)
print(json.dumps(grants, separators=(",", ":")))
')"
  "${PSQL[@]}" -v grants="$NEW_GRANTS" <<'SQL'
do $body$
begin
  if not exists (select 1 from pg_roles where rolname = 'hosted_migrator') then
    create role hosted_migrator nologin nosuperuser bypassrls inherit;
  end if;
end
$body$;
grant postgres to hosted_migrator;
alter system set supautils.policy_grants = :'grants';
select pg_reload_conf();
SQL
  ready=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if [[ "$("${PSQL[@]}" -tAc "select current_setting('supautils.policy_grants', true) like '%hosted_migrator%'")" == "t" ]]; then
      ready=1
      break
    fi
    sleep 0.2
  done
  if [[ "$ready" != 1 ]]; then
    echo "supautils.policy_grants did not include hosted_migrator after reload" >&2
    exit 1
  fi
  HOSTED_MIGRATOR=1
fi

echo "==> applying migrations"
for f in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  echo "    $(basename "$f")"
  if [[ "$HOSTED_MIGRATOR" == 1 ]] && grep -Eq 'storage\.(objects|buckets)' "$f"; then
    { printf '%s\n' 'set role hosted_migrator;'; cat "$f"; } | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q >/dev/null
  else
    "${PSQL[@]}" -f "$f" >/dev/null
  fi
done

echo "==> applying test helpers"
for f in "$TESTS_DIR"/_shim/*.sql; do
  if [[ "$(basename "$f")" != 00_* ]]; then
    "${PSQL[@]}" -f "$f" >/dev/null
  fi
done

echo "==> running pgTAP tests"
"${PSQL[@]}" -c "create extension if not exists pgtap;" >/dev/null

FAILED=0
for f in $(ls "$TESTS_DIR"/*.sql | sort); do
  echo "--- $(basename "$f")"
  # Each test file runs in its own transaction and is rolled back.
  OUT="$( { echo "begin;"; cat "$f"; echo "rollback;"; } | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -t -A 2>&1 )" || { echo "$OUT"; FAILED=1; continue; }
  echo "$OUT" | sed '/^$/d'
  if echo "$OUT" | grep -qE '^not ok|^# Looks like you failed'; then FAILED=1; fi
done

if [[ "$FAILED" -ne 0 ]]; then
  echo "DB TESTS FAILED" >&2
  exit 1
fi
echo "DB TESTS PASSED"
