#!/usr/bin/env bash
# Post-MixMonitor handler.
# Args (passed via dialplan b(...) substitution):
#   $1 uniqueid   $2 linkedid   $3 queue   $4 file_path   $5 caller   $6 callee
# Asterisk MixMonitor `b(script^arg1^arg2...)` invokes script with args separated by space.
# This wrapper expects positional args in that order.

set -euo pipefail

UNIQUEID="${1:?uniqueid}"
LINKEDID="${2:?linkedid}"
QUEUE="${3:?queue}"
FILE="${4:?file}"
CALLER="${5:-}"
CALLEE="${6:-}"

LOG=/var/log/asterisk/mixmonitor_post.log
exec >>"${LOG}" 2>&1
echo "[$(date -Is)] start uniqueid=${UNIQUEID} file=${FILE}"

# wait until MixMonitor closes the file (race protection)
for i in 1 2 3 4 5; do
  if [ -s "${FILE}" ] && ! lsof "${FILE}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if [ ! -s "${FILE}" ]; then
  echo "ERROR file missing or empty: ${FILE}"
  exit 1
fi

SHA256=$(sha256sum "${FILE}" | awk '{print $1}')
SIZE=$(stat -c%s "${FILE}")
CODEC="wav"
STARTED_AT=$(stat -c%y "${FILE}" | cut -d. -f1)

PGURL="postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DB}"

psql "${PGURL}" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO recordings (uniqueid, linkedid, queue, agent_id, caller, callee,
                        file_path, file_size, codec, sha256, started_at, ended_at,
                        archived_at, retention_until)
VALUES ('${UNIQUEID}', '${LINKEDID}', '${QUEUE}', NULL,
        '${CALLER}', '${CALLEE}',
        '${FILE}', ${SIZE}, '${CODEC}', '${SHA256}',
        '${STARTED_AT}'::timestamptz, now(),
        NULL, now() + interval '6 months')
ON CONFLICT (uniqueid) DO UPDATE SET
   file_path = EXCLUDED.file_path,
   file_size = EXCLUDED.file_size,
   sha256    = EXCLUDED.sha256,
   ended_at  = EXCLUDED.ended_at;
SQL

echo "[$(date -Is)] indexed ${UNIQUEID} sha256=${SHA256} size=${SIZE}"
