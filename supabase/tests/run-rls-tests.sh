#!/usr/bin/env bash
# Menjalankan test RLS terhadap Postgres sementara (lokal, tanpa Docker).
# Butuh binary Postgres (initdb, pg_ctl, psql). Atur PG_BIN jika tidak ada di PATH.
set -euo pipefail
cd "$(dirname "$0")"

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PG_BIN:$PATH"
TMP="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  chown -R postgres "$TMP"
  RUN_AS=(runuser -u postgres --)
fi
cleanup() { "${RUN_AS[@]}" pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

"${RUN_AS[@]}" initdb -D "$TMP/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" pg_ctl -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$TMP" -p "$PORT" -U postgres -d postgres)
"${PSQL[@]}" -f 00_supabase_stub.sql
"${PSQL[@]}" -f ../migrations/0001_init.sql
"${PSQL[@]}" -o /dev/null -f rls_test.sql
echo "Semua test RLS lulus."
