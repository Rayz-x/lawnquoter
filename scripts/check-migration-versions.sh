#!/usr/bin/env bash
# Fail when two files in supabase/migrations share the same YYYYMMDDHHMMSS prefix.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/supabase/migrations"

if [[ ! -d "$DIR" ]]; then
  echo "missing migrations dir: $DIR" >&2
  exit 1
fi

versions=()
for file in "$DIR"/*.sql; do
  [[ -e "$file" ]] || continue
  base="$(basename "$file")"
  if [[ "$base" =~ ^([0-9]{14})_ ]]; then
    versions+=("${BASH_REMATCH[1]}")
  else
    echo "migration filename missing YYYYMMDDHHMMSS_ prefix: $base" >&2
    exit 1
  fi
done

if [[ ${#versions[@]} -eq 0 ]]; then
  echo "no migration files found in $DIR" >&2
  exit 1
fi

dupes="$(printf '%s\n' "${versions[@]}" | sort | uniq -d)"
if [[ -n "$dupes" ]]; then
  echo "Duplicate migration version prefixes in supabase/migrations:" >&2
  while IFS= read -r prefix; do
    [[ -z "$prefix" ]] && continue
    for file in "$DIR/${prefix}_"*.sql; do
      echo "  $(basename "$file")" >&2
    done
  done <<<"$dupes"
  exit 1
fi

echo "Migration version prefixes are unique (${#versions[@]} files)."
