#!/usr/bin/env bash
# diag-audio.sh — за один прогон во время тестового звонка локализует виновное плечо RTP.
#
# Плечи:
#   GSM -> Asterisk : входящий RTP с 10.1.5.64/27 на ${GSM_MEDIA_IP} (enp6s0f0).
#   Asterisk -> агент: исходящий RTP на 192.168.x ...
#
# Маршруты GSM (не /32!): 10.1.5.0/24, 10.1.5.8/29, 10.1.5.64/27 via 172.16.4.1 dev enp13s4f0.
set -euo pipefail
cd "$(dirname "$0")/.."

GSM_SIGNAL_NET="${SIP_PROVIDER_SIGNAL_NET:-10.1.5.8/29}"
GSM_NET="${SIP_PROVIDER_MEDIA_NET:-10.1.5.64/27}"
GSM_ROUTE_NET="${GSM_ROUTE_NET:-10.1.5.0/24}"
AGENT_NET="${AGENT_NET:-192.168}"
GSM_SIGNAL_IFACE="${GSM_SIGNAL_IFACE:-enp13s4f0}"
GSM_MEDIA_IFACE="${GSM_MEDIA_IFACE:-enp6s0f0}"
GSM_MEDIA_IP="${GSM_MEDIA_ADDRESS:-172.16.6.183}"
AGENT_IFACE="${AGENT_IFACE:-enp6s0f0}"
LOG="${ASTERISK_LOG:-/var/log/asterisk/full}"
WATCH=0
while getopts "w:" opt; do case "$opt" in w) WATCH="$OPTARG";; *) ;; esac; done

C0='\033[0m'; CB='\033[1m'; CG='\033[0;32m'; CR='\033[0;31m'; CY='\033[0;33m'
hdr() { echo -e "\n${CB}== $* ==${C0}"; }

AST() {
  if docker compose ps asterisk-a 2>/dev/null | grep -q Up; then
    docker compose exec -T asterisk-a asterisk -rx "$*" 2>/dev/null || true
  elif command -v asterisk >/dev/null 2>&1; then
    asterisk -rx "$*" 2>/dev/null || true
  fi
}
LOGGREP() {
  local pat="$1"
  if docker compose ps asterisk-a 2>/dev/null | grep -q Up; then
    docker compose exec -T asterisk-a sh -c "grep -aE '$pat' '$LOG' 2>/dev/null | tail -n 4" 2>/dev/null || true
  else
    grep -aE "$pat" "$LOG" 2>/dev/null | tail -n 4 || true
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
if [[ "$WATCH" -gt 0 ]]; then
  echo -e "${CY}  ... пауза ${WATCH}s, повтор для прироста ...${C0}"; sleep "$WATCH"
  hdr "2b. channelstats повторно (сравните RxPkt/TxPkt)"
  AST 'pjsip show channelstats'
fi

hdr "3. Входящий RTP от GSM (любой 10.1.5.x, подсеть ${GSM_NET})  [плечо GSM -> Asterisk]"
GSM_RTP="$(LOGGREP 'Got +RTP packet from +10\.1\.5')"
if [[ -n "$GSM_RTP" ]]; then echo -e "${CG}  есть входящий RTP от GSM (10.1.5.x):${C0}"; echo "$GSM_RTP" | sed 's/^/    /';
else echo -e "${CR}  НЕТ 'Got RTP ... 10.1.5' -> UMG не шлёт медиа на ${GSM_MEDIA_IP} (см. tcpdump -i ${GSM_MEDIA_IFACE} net ${GSM_NET})${C0}"; fi

hdr "4. Входящий RTP от агента (${AGENT_NET}.x)  [плечо агент -> Asterisk, обычно ОК]"
AG_RTP="$(LOGGREP "Got +RTP packet from +${AGENT_NET}")"
if [[ -n "$AG_RTP" ]]; then echo -e "${CG}  есть входящий RTP от агента (микрофон):${C0}"; echo "$AG_RTP" | sed 's/^/    /';
else echo -e "${CY}  нет 'Got RTP ... ${AGENT_NET}' (агент не говорит / WSS не поднят)${C0}"; fi

hdr "5. Вердикт"
echo "  Сопоставьте признаки:"
echo -e "   - нет п.3 (GSM RTP с 10.1.5.x)     -> ${CB}виноват вход GSM/UMG${C0}:"
echo "       provider RxPkt=0 при TxPkt>0; на ${GSM_MEDIA_IFACE} только Out (net ${GSM_NET})."
echo "       Эскалация: UMG (${GSM_NET}) должен слать RTP на ${GSM_MEDIA_IP}."
echo -e "   - п.3 есть, TxPkt агента в п.2 растёт,"
echo -e "     но у агента in=NO-inbound-rtp -> ${CB}виноват выход на агента${C0}: firewall outbound 3044"

hdr "6. tcpdump-подсказки (во время звонка, отдельные терминалы)"
echo "  GSM media:   sudo tcpdump -ni ${GSM_MEDIA_IFACE} net ${GSM_NET} and udp -vv"
echo "  GSM SIP:     sudo tcpdump -ni ${GSM_SIGNAL_IFACE} net ${GSM_SIGNAL_NET} and udp port 5060"
echo "  агент media: sudo tcpdump -ni ${AGENT_IFACE} net ${AGENT_NET}.0/16 and udp portrange 10000-20000"
