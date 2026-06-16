#!/usr/bin/env bash
# diag-audio.sh — за один прогон во время тестового звонка локализует виновное плечо RTP.
#
# Плечи:
#   GSM -> Asterisk : входящий RTP с 10.1.5.75 (media GSM). Нет "Got RTP ... 10.1.5" -> вход GSM.
#   Asterisk -> агент: исходящий RTP на 192.168.x. Нет "Got RTP ... 192.168" + TxPkt растёт,
#                      но у агента in=NO-inbound-rtp -> режет firewall (outbound 3044), см. runbook.
#
# Запуск НА СЕРВЕРЕ во время активного звонка:
#   ./scripts/diag-audio.sh            # один снимок
#   ./scripts/diag-audio.sh -w 8       # снять channelstats дважды с паузой 8с (видно прирост Rx/Tx)
set -euo pipefail
cd "$(dirname "$0")/.."

GSM_MEDIA="${SIP_PROVIDER_MEDIA:-10.1.5.75}"
GSM_NET="${SIP_PROVIDER_MEDIA_NET:-10.1.5.64/27}"
AGENT_NET="${AGENT_NET:-192.168}"
GSM_IFACE="${GSM_IFACE:-enp13s4f0}"
AGENT_IFACE="${AGENT_IFACE:-enp6s0f0}"
LOG="${ASTERISK_LOG:-/var/log/asterisk/full}"
WATCH=0
while getopts "w:" opt; do case "$opt" in w) WATCH="$OPTARG";; *) ;; esac; done

C0='\033[0m'; CB='\033[1m'; CG='\033[0;32m'; CR='\033[0;31m'; CY='\033[0;33m'
hdr() { echo -e "\n${CB}== $* ==${C0}"; }

# asterisk -rx через docker или хостовый бинарь
AST() {
  if docker compose ps asterisk-a 2>/dev/null | grep -q Up; then
    docker compose exec -T asterisk-a asterisk -rx "$*" 2>/dev/null || true
  elif command -v asterisk >/dev/null 2>&1; then
    asterisk -rx "$*" 2>/dev/null || true
  fi
}
# grep по логу (в контейнере или на хосте)
LOGGREP() {
  local pat="$1"
  if docker compose ps asterisk-a 2>/dev/null | grep -q Up; then
    docker compose exec -T asterisk-a sh -c "grep -aE '$pat' '$LOG' 2>/dev/null | tail -n 4" 2>/dev/null || true
  else
    grep -aE "$pat" "$LOG" 2>/dev/null | tail -n 4 || true
  fi
}

hdr "1. Маршрут и rp_filter к GSM media ${GSM_MEDIA}"
ip route get "$GSM_MEDIA" 2>/dev/null || echo "  (ip route get недоступен)"
echo "  route table:"; ip r 2>/dev/null | grep -E "10\.1\.5\.|${AGENT_NET}\." | sed 's/^/    /' || true
echo "  rp_filter (0=off, 2=loose рекомендуется для асимм. GSM):"
for f in all "$GSM_IFACE" "$AGENT_IFACE"; do
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

hdr "3. Входящий RTP от GSM (${GSM_NET})  [плечо GSM -> Asterisk]"
GSM_RTP="$(LOGGREP 'Got +RTP packet from +10\.1\.5')"
if [[ -n "$GSM_RTP" ]]; then echo -e "${CG}  есть входящий RTP от GSM:${C0}"; echo "$GSM_RTP" | sed 's/^/    /';
else echo -e "${CR}  НЕТ 'Got RTP ... 10.1.5' -> GSM media не доходит до Asterisk${C0}"; fi

hdr "4. Входящий RTP от агента (${AGENT_NET}.x)  [плечо агент -> Asterisk, обычно ОК]"
AG_RTP="$(LOGGREP "Got +RTP packet from +${AGENT_NET}")"
if [[ -n "$AG_RTP" ]]; then echo -e "${CG}  есть входящий RTP от агента (микрофон):${C0}"; echo "$AG_RTP" | sed 's/^/    /';
else echo -e "${CY}  нет 'Got RTP ... ${AGENT_NET}' (агент не говорит / WSS не поднят)${C0}"; fi

hdr "5. Вердикт"
echo "  Сопоставьте признаки:"
echo -e "   - нет п.3 (GSM RTP)            -> ${CB}виноват вход GSM${C0}: редеплой repo-конфига + ACL/SBC на стороне GSM"
echo -e "   - п.3 есть, TxPkt в п.2 растёт,"
echo -e "     но у агента in=NO-inbound-rtp -> ${CB}виноват выход на агента${C0}: firewall outbound 3044 (172.16.6.183 -> ${AGENT_NET}.x UDP 10000-20000/3478)"
echo -e "                                      или A/B AGENT_WEBRTC_MODE=standard (см. ops/audio-two-way-runbook.md)"

hdr "6. tcpdump-подсказки (запустить в отдельных терминалах во время звонка)"
echo "  GSM media:   sudo tcpdump -ni ${GSM_IFACE}  host ${GSM_MEDIA} and udp"
echo "  агент media: sudo tcpdump -ni ${AGENT_IFACE} net ${AGENT_NET}.0/16 and udp portrange 10000-20000"
