#!/usr/bin/env bash
# Сформировать текст заявки GSM по шаблону ops/gsm-voice-diagnosis.md
set -euo pipefail
cd "$(dirname "$0")/.."

GSM_MEDIA_IP="${GSM_MEDIA_ADDRESS:-10.212.154.35}"
GSM_MEDIA_VIA="${GSM_ROUTE_MEDIA_VIA:-10.212.154.34}"
GSM_MEDIA_DEV="${GSM_ROUTE_MEDIA_DEV:-enp13s4f1}"
GSM_MEDIA_NET="${GSM_ROUTE_MEDIA_NET:-10.1.5.64/27}"
PUBLIC_IP="${PUBLIC_DOMAIN:-172.16.6.183}"
GSM_UMG_TEST_IP="${GSM_UMG_TEST_IP:-10.1.5.72}"

if [[ -f .env ]]; then
  # shellcheck source=/dev/null
  source .env 2>/dev/null || true
  GSM_MEDIA_IP="${GSM_MEDIA_ADDRESS:-10.212.154.35}"
  GSM_MEDIA_VIA="${GSM_ROUTE_MEDIA_VIA:-10.212.154.34}"
  GSM_MEDIA_DEV="${GSM_ROUTE_MEDIA_DEV:-enp13s4f1}"
  GSM_MEDIA_NET="${GSM_ROUTE_MEDIA_NET:-10.1.5.64/27}"
  PUBLIC_IP="${PUBLIC_DOMAIN:-172.16.6.183}"
  GSM_UMG_TEST_IP="${GSM_UMG_TEST_IP:-10.1.5.72}"
fi

REPORT="${1:-/tmp/gsm-voice-diagnosis.txt}"
OUT="${2:-ops/gsm-ticket-ready.txt}"

IN_CNT=0
OUT_CNT=0
if [[ -f "$REPORT" ]]; then
  _in=$(grep -oE 'LEG1 tcpdump summary: In=[0-9]+' "$REPORT" 2>/dev/null | tail -1 | grep -oE '[0-9]+$' || true)
  _out=$(grep -oE 'LEG1 tcpdump summary: Out=[0-9]+' "$REPORT" 2>/dev/null | tail -1 | grep -oE '[0-9]+$' || true)
  IN_CNT=$((_in + 0))
  OUT_CNT=$((_out + 0))
fi

GSM_RTP_CNT=0
if systemctl is-active cc-asterisk 2>/dev/null | grep -qE '^(active|activating)$' \
   || systemctl is-active asterisk 2>/dev/null | grep -qE '^(active|activating)$'; then
  GSM_RTP_CNT=$(sh -c \
    'grep -c "Got  RTP packet from    10.1.5" /var/log/asterisk/full 2>/dev/null || true' | tr -d '\r\n ')
  GSM_RTP_CNT=$((GSM_RTP_CNT + 0))
fi

{
  echo "=== GSM ticket $(date -Is) ==="
  echo ""
  echo "> **PBX:** GSM RTP \`${GSM_MEDIA_IP}\` (${GSM_MEDIA_DEV}), SIP \`172.16.4.19\`, WebRTC \`${PUBLIC_IP}\`"
  echo "> **Маршруты:** SIG \`10.1.5.8/29\` via \`172.16.4.1\`; media \`${GSM_MEDIA_NET}\` via \`${GSM_MEDIA_VIA}\` dev \`${GSM_MEDIA_DEV}\` — traceroute до \`.10\` и \`${GSM_UMG_TEST_IP}\` OK."
  echo "> **SIP:** INVITE на 1263 доходит, ответы 100/183/200 OK."
  echo "> **RTP исходящий:** PBX шлёт \`${GSM_MEDIA_IP}:PORT -> ${GSM_UMG_TEST_IP}:PORT\` (любой хост /27; tcpdump Out=${OUT_CNT})."
  echo "> **RTP входящий:** с подсети \`${GSM_MEDIA_NET}\` на \`${GSM_MEDIA_IP}:10000-20000\` **нет** (tcpdump In=${IN_CNT}, Asterisk Got RTP from 10.1.5 count=${GSM_RTP_CNT})."
  echo ">"
  echo "> Просим:"
  echo "> 1. Разрешить **входящий UDP** \`${GSM_MEDIA_NET} -> ${GSM_MEDIA_IP}:10000-20000\` (все хосты /27, не только ${GSM_UMG_TEST_IP})."
  echo "> 2. Проверить UMG: отвечает ли RTP на адрес из SDP (\`c=IN IP4 ${GSM_MEDIA_IP}\`)."
  echo "> 3. Отключить **mandatory SIP preconditions** на транке к \`172.16.4.19\`."
  echo ""
  echo "--- Evidence: ${REPORT} ---"
} | tee "$OUT"

echo "Ticket saved: $OUT"
