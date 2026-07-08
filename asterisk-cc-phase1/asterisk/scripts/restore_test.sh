#!/usr/bin/env bash
# Quarterly restore test: PITR to a temp Postgres on a sandbox VM, then sanity-check.
set -euo pipefail

STANZA="${STANZA:-cc}"
TARGET_DIR="${TARGET_DIR:-/var/lib/pgsql/16/data-restore}"

systemctl stop postgresql-restore || true
rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"

pgbackrest --stanza="${STANZA}" --pg1-path="${TARGET_DIR}" --type=time \
           --target="$(date -d 'yesterday 23:59' '+%F %T')" restore

systemctl start postgresql-restore
sleep 5

PGURL="postgresql://postgres@127.0.0.1:5433/asterisk_cc"
psql "${PGURL}" <<SQL
SELECT 'cdr' AS table, count(*) FROM cdr WHERE start > now() - interval '7 days'
UNION ALL SELECT 'cel', count(*) FROM cel WHERE eventtime > now() - interval '7 days'
UNION ALL SELECT 'queue_log', count(*) FROM queue_log WHERE "time" > now() - interval '7 days'
UNION ALL SELECT 'recordings', count(*) FROM recordings WHERE started_at > now() - interval '7 days';
SQL

psql "${PGURL}" -c "
SELECT log_action('system','system','backup_restore_test', NULL,
                  jsonb_build_object('target','${TARGET_DIR}'), NULL, 'restore_test.sh');
"
