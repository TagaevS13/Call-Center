#!/usr/bin/env bash
# Physically deletes recording files marked for deletion (deleted_at IS NOT NULL)
# and older than safety window. Logs every removal in audit_log.
set -euo pipefail

SAFETY_DAYS="${SAFETY_DAYS:-7}"
PGURL="postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DB}"

mapfile -t ROWS < <(
    psql "${PGURL}" -At -F '|' -c "
        SELECT uniqueid, file_path
          FROM recordings
         WHERE deleted_at IS NOT NULL
           AND deleted_at < now() - interval '${SAFETY_DAYS} days'
           AND file_path IS NOT NULL
         LIMIT 5000;
    "
)

for row in "${ROWS[@]}"; do
    uid="${row%%|*}"
    path="${row#*|}"
    if [ -n "${path}" ] && [ -f "${path}" ]; then
        rm -f "${path}"
        psql "${PGURL}" -c "
            UPDATE recordings SET file_path = NULL WHERE uniqueid = '${uid}';
            SELECT log_action('system','system','recording_deleted','${uid}',
                              jsonb_build_object('path','${path}'),NULL,'cleanup');
        " >/dev/null
    fi
done
