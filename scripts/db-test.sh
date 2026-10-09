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

echo "==> applying migrations"
for f in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  echo "    $(basename "$f")"
  "${PSQL[@]}" -f "$f" >/dev/null
done

echo "==> applying test helpers"
for f in "$TESTS_DIR"/_shim/*.sql; do
  if [[ "$(basename "$f")" != 00_* ]]; then
    "${PSQL[@]}" -f "$f" >/dev/null
  fi
done

echo "==> running pgTAP tests"
"${PSQL[@]}" -c "create extension if not exists pgtap;" >/dev/null
# The privilege migration revokes the built-in PUBLIC EXECUTE default. pgTAP is
# installed after that, so its functions need an explicit grant for impersonated roles.
"${PSQL[@]}" <<'SQL' >/dev/null
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_depend d
    join pg_proc p on p.oid = d.objid
    join pg_extension e on e.oid = d.refobjid
    where e.extname = 'pgtap'
      and d.classid = 'pg_proc'::regclass
      and d.deptype = 'e'
  loop
    execute format('grant execute on function %s to public', fn);
  end loop;
end
$$;
SQL

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
