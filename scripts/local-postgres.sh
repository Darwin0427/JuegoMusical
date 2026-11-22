#!/usr/bin/env bash
# Levanta un Postgres local desechable para las pruebas de base de datos (si no hay DATABASE_URL).
# Uso: source scripts/local-postgres.sh
set -e
PGBIN="$(dirname "$(command -v pg_config >/dev/null && pg_config --bindir || echo /usr/lib/postgresql/16/bin/x)")"
[ -x "$PGBIN/initdb" ] || PGBIN=/usr/lib/postgresql/16/bin
DATA=/tmp/jm-pg
PORT=54329
RUNAS=""
[ "$(id -u)" = "0" ] && RUNAS="su postgres -s /bin/bash -c"
run() { if [ -n "$RUNAS" ]; then $RUNAS "$*"; else bash -c "$*"; fi; }
if [ ! -f "$DATA/PG_VERSION" ]; then
  mkdir -p "$DATA" && [ -n "$RUNAS" ] && chown postgres "$DATA"
  run "$PGBIN/initdb -D $DATA -U postgres --auth=trust >/dev/null"
fi
run "$PGBIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp -c listen_addresses=127.0.0.1' -l $DATA/log.txt status >/dev/null || $PGBIN/pg_ctl -D $DATA -o '-p $PORT -k /tmp -c listen_addresses=127.0.0.1' -l $DATA/log.txt -w start >/dev/null"
export DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/postgres"
echo "Postgres de pruebas en $DATABASE_URL"
