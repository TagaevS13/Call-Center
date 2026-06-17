#!/usr/bin/env bash
# Снять доказательства во время тестового звонка (split NIC: signal .4.19 / media .6.183).
set -euo pipefail
cd "$(dirname "$0")/.."
LOG="${DEBUG_LOG:-debug-1d948b.log}"
SESSION="${DEBUG_SESSION:-1d948b}"
TS=$(date +%s%3N)

jlog() {
  local hid="$1" loc="$2" msg="$3" data="$4"
  printf '{"sessionId":"%s","runId":"capture","hypothesisId":"%s","location":"%s","message":"%s","data":%s,"timestamp":%s}\n' \
    "$SESSION" "$hid" "$loc" "$msg" "$data" "$TS" >>"$LOG"
}

AST() {
  docker compose exec -T asterisk-a asterisk -rx "$*" 2>/dev/null || true
}

routes=$(ip r | grep 10.1.5 || true)
media=$(docker compose exec -T asterisk-a grep '^media_address=' /etc/asterisk/pjsip_provider.conf 2>/dev/null || true)
stats1=$(AST 'pjsip show channelstats')
sleep "${1:-8}"
stats2=$(AST 'pjsip show channelstats')
gsm_rtp=$(docker compose exec -T asterisk-a sh -c "tail -c 2000000 /var/log/asterisk/full | grep -a 'Got  RTP packet from' | grep 10.1.5 | tail -5" 2>/dev/null || true)

jlog "D" "capture-call-evidence.sh" "routes" "$(printf '%s' "$routes" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
jlog "E" "capture-call-evidence.sh" "media_address" "$(printf '%s' "$media" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
jlog "D" "capture-call-evidence.sh" "channelstats_before" "$(printf '%s' "$stats1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
jlog "D" "capture-call-evidence.sh" "channelstats_after" "$(printf '%s' "$stats2" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
jlog "D" "capture-call-evidence.sh" "gsm_got_rtp_tail" "$(printf '%s' "$gsm_rtp" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"

echo "=== routes ==="; echo "$routes"
echo "=== media ==="; echo "$media"
echo "=== channelstats (after ${1:-8}s) ==="; echo "$stats2"
echo "=== gsm got rtp ==="; echo "$gsm_rtp"
echo "Logged to $LOG"
