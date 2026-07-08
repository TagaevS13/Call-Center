#!/bin/bash
# Apply CC_MEDIA_DEBUG / CC_RTP_DEBUG settings once Asterisk is up.
set -euo pipefail

if [[ -f /etc/cc/cc.env ]]; then
  set -a
  # shellcheck source=/dev/null
  source /etc/cc/cc.env
  set +a
fi

[[ "${CC_MEDIA_DEBUG:-1}" == "0" ]] && exit 0

AST_BIN="/usr/sbin/asterisk"
[[ -x "${AST_BIN}" ]] || AST_BIN="/usr/sbin/asterisk-bin"

for _ in $(seq 1 60); do
  if "${AST_BIN}" -rx "core show version" 2>/dev/null | grep -qi asterisk; then
    break
  fi
  sleep 2
done

"${AST_BIN}" -rx "core set verbose 5" 2>/dev/null || true
"${AST_BIN}" -rx "core set debug 3" 2>/dev/null || true
"${AST_BIN}" -rx "pjsip set logger on" 2>/dev/null || true
if [[ "${CC_RTP_DEBUG:-0}" == "1" ]]; then
  "${AST_BIN}" -rx "rtp set debug on" 2>/dev/null || true
  echo "cc-media-debug: RTP packet debug ON" >&2
else
  "${AST_BIN}" -rx "rtp set debug off" 2>/dev/null || true
fi
echo "cc-media-debug: enabled (CC_MEDIA_DEBUG=${CC_MEDIA_DEBUG:-1})" >&2
"${AST_BIN}" -rx "module reload cdr_pgsql.so" 2>/dev/null || true
"${AST_BIN}" -rx "module reload cel_pgsql.so" 2>/dev/null || true
