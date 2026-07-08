#!/usr/bin/env bash
# diag-audio.sh — за один прогон во время тестового звонка локализует виновное плечо RTP.
#
# Плечи:
#   GSM -> Asterisk : входящий RTP с 10.1.5.64/27 на ${GSM_MEDIA_IP} (enp13s4f1).
#   Asterisk -> агент: SRTP на ${PUBLIC_IP} -> 192.168.x (в логе Asterisk — ${PUBLIC_IP}:PORT).
#
# Маршруты GSM (split): 10.1.5.8/29 via 172.16.4.1 enp13s4f0; 10.1.5.64/27 via 10.212.154.34 enp13s4f1.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  # shellcheck source=/dev/null
  source .env 2>/dev/null || true
fi

GSM_SIGNAL_NET="${SIP_PROVIDER_SIGNAL_NET:-10.1.5.8/29}"
GSM_NET="${SIP_PROVIDER_MEDIA_NET:-10.1.5.64/27}"
AGENT_NET="${AGENT_NET:-192.168}"
GSM_SIGNAL_IFACE="${GSM_SIGNAL_IFACE:-enp13s4f0}"
GSM_MEDIA_IFACE="${GSM_MEDIA_IFACE:-enp13s4f1}"
GSM_MEDIA_IP="${GSM_MEDIA_ADDRESS:-10.212.154.35}"
AGENT_IFACE="${AGENT_IFACE:-enp6s0f0}"
PUBLIC_IP="${PUBLIC_DOMAIN:-172.16.6.183}"
LOG="${ASTERISK_LOG:-/var/log/asterisk/full}"
LOG_TAIL_BYTES="${LOG_TAIL_BYTES:-3000000}"
WATCH=0
while getopts "w:" opt; do case "$opt" in w) WATCH="$OPTARG";; *) ;; esac; done

C0='\033[0m'; CB='\033[1m'; CG='\033[0;32m'; CR='\033[0;31m'; CY='\033[0;33m'
hdr() { echo -e "\n${CB}== $* ==${C0}"; }

AST() {
  if command -v asterisk >/dev/null 2>&1; then
    asterisk -rx "$*" 2>/dev/null || true
  elif [[ -x scripts/asterisk-cli.sh ]]; then
    bash scripts/asterisk-cli.sh "$*" 2>/dev/null || true
  fi
}

LOGGREP() {
  local pat="$1"
  tail -c "$LOG_TAIL_BYTES" "$LOG" 2>/dev/null | grep -aE "$pat" | tail -n 4 || true
}

# RxPkt (Receive Count) из pjsip show channelstats
_cs_rx() {
  local role="$1"
  local stats="$2"
  if [[ "$role" == provider ]]; then
    echo "$stats" | grep -E 'provider-' | awk '{print $5}' | head -1
  else
    echo "$stats" | grep -E 'slin|opus|ulaw|alaw' | grep -v provider | awk '{print $5}' | head -1
  fi
}

_cs_tx() {
  local role="$1"
  local stats="$2"
  if [[ "$role" == provider ]]; then
    echo "$stats" | grep -E 'provider-' | awk '{print $9}' | head -1
  else
    echo "$stats" | grep -E 'slin|opus|ulaw|alaw' | grep -v provider | awk '{print $9}' | head -1
  fi
}

hdr "1. Маршруты GSM (подсети, не /32) и rp_filter"
echo "  сигналинг: ${GSM_SIGNAL_NET}"
echo "  медиа:     ${GSM_NET}"
echo "  route table (signal ${GSM_SIGNAL_NET} via ${GSM_SIGNAL_IFACE}, media ${GSM_NET} via ${GSM_MEDIA_IFACE}):"
ip r 2>/dev/null | grep -E "10\.1\.5\.|${AGENT_NET}\." | sed 's/^/    /' || true
for net in "$GSM_SIGNAL_NET" "$GSM_NET"; do
  if ip r 2>/dev/null | grep -qF "$net"; then
    echo -e "    ${CG}OK${C0} route $net"
  else
    echo -e "    ${CR}MISSING${C0} route $net"
  fi
done
echo "  rp_filter (0=off, 2=loose рекомендуется для асимм. GSM):"
for f in all "$GSM_SIGNAL_IFACE" "$GSM_MEDIA_IFACE" "$AGENT_IFACE"; do
  v=$(cat "/proc/sys/net/ipv4/conf/$f/rp_filter" 2>/dev/null || echo "?")
  rc="$CG"; [[ "$v" == "1" ]] && rc="$CR"
  echo -e "    net.ipv4.conf.$f.rp_filter = ${rc}${v}${C0}"
done

hdr "2. PJSIP channelstats (RxPkt/TxPkt по каналам)"
S1="$(AST 'pjsip show channelstats')"
echo "${S1:-  (нет активных каналов / asterisk недоступен)}"
PROV_RX1="$(_cs_rx provider "$S1")"
AG_RX1="$(_cs_rx agent "$S1")"
PROV_TX1="$(_cs_tx provider "$S1")"
AG_TX1="$(_cs_tx agent "$S1")"
S2=""
if [[ "$WATCH" -gt 0 ]]; then
  echo -e "${CY}  ... пауза ${WATCH}s, повтор для прироста ...${C0}"; sleep "$WATCH"
  hdr "2b. channelstats повторно (сравните RxPkt/TxPkt)"
  S2="$(AST 'pjsip show channelstats')"
  echo "${S2:-  (нет активных каналов)}"
fi
PROV_RX2="$(_cs_rx provider "$S2")"
AG_RX2="$(_cs_rx agent "$S2")"

hdr "3. Входящий RTP от GSM (10.1.5.x)  [плечо GSM -> Asterisk]"
GSM_RTP="$(LOGGREP 'Got +RTP packet from +10\.1\.5')"
CC_RTP_DBG="${CC_RTP_DEBUG:-0}"
if [[ -f .env ]]; then
  CC_RTP_DBG="$(grep -E '^CC_RTP_DEBUG=' .env 2>/dev/null | cut -d= -f2 || echo 0)"
fi
if [[ -n "$GSM_RTP" ]]; then
  echo -e "${CG}  есть 'Got RTP ... 10.1.5' в логе (tail -c ${LOG_TAIL_BYTES}):${C0}"
  echo "$GSM_RTP" | sed 's/^/    /'
elif [[ -n "$PROV_RX1" && "$PROV_RX1" =~ ^[0-9]+$ && "$PROV_RX1" -gt 0 ]]; then
  echo -e "${CY}  в логе нет 'Got RTP ... 10.1.5' (CC_RTP_DEBUG=${CC_RTP_DBG}), но provider RxPkt=${PROV_RX1}${C0}"
  echo -e "${CG}  -> GSM RTP доходит до Asterisk (см. channelstats п.2)${C0}"
else
  echo -e "${CR}  нет GSM RTP: provider RxPkt=0 и пустой лог${C0}"
  echo "     tcpdump: sudo tcpdump -ni ${GSM_MEDIA_IFACE} net ${GSM_NET} and udp -c 40"
fi

hdr "4. Входящий RTP от агента (WebRTC)  [плечо агент -> Asterisk]"
# WebRTC в логе Asterisk — как ${PUBLIC_IP}:PORT, не 192.168.x
AG_RTP="$(LOGGREP "Got +RTP packet from +${PUBLIC_IP//./\\.}")"
if [[ -n "$AG_RTP" ]]; then
  echo -e "${CG}  есть входящий RTP от агента (${PUBLIC_IP} в логе Asterisk):${C0}"
  echo "$AG_RTP" | sed 's/^/    /'
elif [[ -n "$AG_TX1" && "$AG_TX1" =~ ^[0-9]+$ && "$AG_TX1" -gt 0 ]]; then
  echo -e "${CY}  в логе нет 'Got RTP ... ${PUBLIC_IP}' (CC_RTP_DEBUG=${CC_RTP_DBG}), но agent TxPkt=${AG_TX1}${C0}"
  echo -e "${CG}  -> микрофон агента доходит до Asterisk (channelstats)${C0}"
else
  echo -e "${CY}  нет RTP от агента в логе (агент молчит / WSS не поднят / CC_RTP_DEBUG=0)${C0}"
fi

hdr "5. Вердикт (channelstats — главный источник; лог — только при CC_RTP_DEBUG=1)"
PROV_DRX=0
AG_DRX=0
if [[ -n "$PROV_RX1" && -n "$PROV_RX2" && "$PROV_RX1" =~ ^[0-9]+$ && "$PROV_RX2" =~ ^[0-9]+$ ]]; then
  PROV_DRX=$((PROV_RX2 - PROV_RX1))
fi
if [[ -n "$AG_RX1" && -n "$AG_RX2" && "$AG_RX1" =~ ^[0-9]+$ && "$AG_RX2" =~ ^[0-9]+$ ]]; then
  AG_DRX=$((AG_RX2 - AG_RX1))
fi

if [[ -n "$PROV_RX1" && "$PROV_RX1" =~ ^[0-9]+$ && "$PROV_RX1" -eq 0 ]]; then
  echo -e "  ${CR}GSM вход обрыв${C0}: provider RxPkt=0; tcpdump на ${GSM_MEDIA_IFACE} — только Out?"
  echo "     Эскалация: UMG (${GSM_NET}) -> ${GSM_MEDIA_IP}:10000-20000"
elif [[ "$PROV_DRX" -gt 0 && "$AG_DRX" -gt 0 ]]; then
  echo -e "  ${CG}Мост Asterisk OK${C0}: provider Rx +${PROV_DRX}, agent Rx +${AG_DRX} за ${WATCH}s"
  echo "     GSM -> PBX -> WebRTC на уровне пакетов работает."
  echo -e "  ${CY}Если абонента не слышно при растущем in= в браузере:${C0}"
  echo "     - F12 [CC-RTP]: смотрите audioLevel / totalAudioEnergy (не только bytes)"
  echo "     - chrome://webrtc-internals -> inbound-rtp audioLevel"
  echo "     - Прослушайте MixMonitor: ls -lt /var/spool/asterisk/recordings/*/*/*.wav | head -3"
  echo "     - tcpdump leg2: sudo tcpdump -ni ${AGENT_IFACE} src ${PUBLIC_IP} and dst ${AGENT_NET}.0/16 and udp -c 30"
elif [[ "$PROV_DRX" -gt 0 && "$AG_DRX" -eq 0 ]]; then
  echo -e "  ${CR}Мост / WebRTC исход${C0}: GSM Rx растёт (+${PROV_DRX}), agent Rx не растёт"
  echo "     Проверьте bridge, codec transcoding, pjsip show channelstats на обоих каналах"
elif [[ -z "$PROV_RX1" || ! "$PROV_RX1" =~ ^[0-9]+$ ]]; then
  echo "  Нет активного звонка — запустите во время разговора с -w 8"
else
  echo "  Сопоставьте вручную п.2–4 и tcpdump (см. п.6)"
fi

if [[ "$CC_RTP_DBG" != "1" ]]; then
  echo -e "  ${CY}Подсказка:${C0} для строк 'Got RTP' в /var/log/asterisk/full: CC_RTP_DEBUG=1 + restart cc-asterisk"
fi

hdr "6. tcpdump-подсказки (во время звонка, отдельные терминалы)"
echo "  GSM media:   sudo tcpdump -ni ${GSM_MEDIA_IFACE} net ${GSM_NET} and udp -vv"
echo "  GSM SIP:     sudo tcpdump -ni ${GSM_SIGNAL_IFACE} net ${GSM_SIGNAL_NET} and udp port 5060"
echo "  PBX -> агент: sudo tcpdump -ni ${AGENT_IFACE} src ${PUBLIC_IP} and net ${AGENT_NET}.0/16 and udp"
