#!/usr/bin/env bash
# Runs the database (RLS) tests against a throwaway local Postgres.
# Uses $TEST_DATABASE_URL if set; otherwise starts a temporary cluster with initdb.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  [[ -x "$PGBIN/initdb" ]] || { echo "initdb not found; set PGBIN or TEST_DATABASE_URL" >&2; exit 1; }
  DIR="$(mktemp -d)"
  RUN=()
  if [[ $EUID -eq 0 ]]; then chown postgres "$DIR"; RUN=(runuser -u postgres --); fi
  PORT="${PGPORT_TEST:-54329}"
  "${RUN[@]}" "$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust >/dev/null
  "${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=localhost" -l "$DIR/log" -w start >/dev/null
  trap '"${RUN[@]}" "$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null; rm -rf "$DIR"' EXIT
  export TEST_DATABASE_URL="postgres://postgres@localhost:$PORT/postgres"
fi

npx vitest run --config vitest.db.config.mts "$@"
