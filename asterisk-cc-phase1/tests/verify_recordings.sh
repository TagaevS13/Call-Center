#!/usr/bin/env bash
# Sample 1% of recordings from the last day and verify SHA-256 vs DB.
set -euo pipefail

PGURL="postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DB}"

mapfile -t SAMPLE < <(
    psql "${PGURL}" -At -F '|' -c "
        SELECT uniqueid, file_path, sha256
          FROM recordings
         WHERE started_at > now() - interval '1 day'
           AND file_path IS NOT NULL
           AND sha256 IS NOT NULL
         ORDER BY random()
         LIMIT GREATEST(1, (SELECT count(*)/100 FROM recordings
                            WHERE started_at > now() - interval '1 day'));
    "
)

fail=0
for row in "${SAMPLE[@]}"; do
    uid="${row%%|*}"; rest="${row#*|}"
    path="${rest%%|*}"; want="${rest##*|}"
    if [ -f "${path}" ]; then
        got=$(sha256sum "${path}" | awk '{print $1}')
        if [ "${got}" != "${want}" ]; then
            echo "MISMATCH ${uid}: ${path}"
            fail=$((fail+1))
        fi
    else
        echo "MISSING  ${uid}: ${path}"
        fail=$((fail+1))
    fi
done

if [ "${fail}" -gt 0 ]; then
    psql "${PGURL}" -c "SELECT log_action('system','system','recordings_verify_failed',
        NULL, jsonb_build_object('failures',${fail}), NULL, 'verify_recordings.sh');"
    exit 1
fi

psql "${PGURL}" -c "SELECT log_action('system','system','recordings_verify_ok',
    NULL, jsonb_build_object('sampled',${#SAMPLE[@]}), NULL, 'verify_recordings.sh');"
