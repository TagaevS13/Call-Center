#!/bin/bash
# Снимок RTP/PJSIP во время звонка агента (запуск на сервере внутри контейнера).
set -euo pipefail
DURATION="${1:-90}"
INTERVAL="${2:-3}"
OUT="${3:-/var/log/asterisk/cc_media_trace.log}"
AST="/usr/sbin/asterisk"
[[ -x "${AST}" ]] || AST="/usr/sbin/asterisk-bin"

{
  echo "=== cc_media_trace start $(date -Is) duration=${DURATION}s interval=${INTERVAL}s ==="
  "${AST}" -rx "core show version" 2>/dev/null || true
  "${AST}" -rx "rtp show settings" 2>/dev/null || true
} >> "${OUT}"

end=$((SECONDS + DURATION))
while [[ "${SECONDS}" -lt "${end}" ]]; do
  {
    echo ""
    echo "--- $(date -Is) ---"
    "${AST}" -rx "core show channels verbose" 2>/dev/null | head -40 || true
    "${AST}" -rx "pjsip show channelstats" 2>/dev/null | grep -E '^(Channel:|1001|provider|918870|Output|Input|Endpoint)' || \
      "${AST}" -rx "pjsip show channelstats" 2>/dev/null | tail -30 || true
    "${AST}" -rx "rtp show stats" 2>/dev/null | tail -25 || true
  } >> "${OUT}" 2>&1
  sleep "${INTERVAL}"
done

{
  echo "=== cc_media_trace end $(date -Is) ==="
  echo "--- tail full (CC-MEDIA|RTP|1001|DTLS|ICE|Bridge) ---"
  tail -200 /var/log/asterisk/full 2>/dev/null | grep -iE 'CC-MEDIA|RTP|1001|DTLS|ICE|Bridge|native_rtp|direct_media|WARNING|ERROR' | tail -80 || true
} >> "${OUT}" 2>&1

echo "written: ${OUT}" >&2
