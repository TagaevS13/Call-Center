#!/usr/bin/env bash
# Сжатие ротированных логов Asterisk (full.0, messages.*) — не трогает активные full/cc_calls.
set -euo pipefail

LOGDIR="${1:-/var/log/asterisk}"
MIN_MB="${CC_LOG_ARCHIVE_MIN_MB:-200}"

if [[ ! -d "${LOGDIR}" ]]; then
  exit 0
fi

archive_large() {
  local f="$1"
  [[ -f "${f}" ]] || return 0
  local mb=$(( $(stat -c%s "${f}" 2>/dev/null || echo 0) / 1048576 ))
  [[ "${mb}" -lt "${MIN_MB}" ]] && return 0
  if [[ ! -f "${f}.gz" ]]; then
    echo "asterisk_log_maintenance: gzip ${f} (${mb} MB)" >&2
    gzip -9 "${f}"
  else
    echo "asterisk_log_maintenance: remove duplicate ${f} (already ${f}.gz)" >&2
    rm -f "${f}"
  fi
}

for pat in full messages pjsip_trace rtp_trace; do
  for f in "${LOGDIR}/${pat}".[0-9]* "${LOGDIR}/${pat}.0"; do
    [[ -e "${f}" ]] || continue
    [[ "${f}" == *.gz ]] && continue
    archive_large "${f}"
  done
done

# Очень старые gzip (>90 дней)
find "${LOGDIR}" -maxdepth 1 -name '*.gz' -mtime +90 -delete 2>/dev/null || true
