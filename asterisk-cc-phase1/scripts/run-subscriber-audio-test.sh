#!/usr/bin/env bash
# Протокол теста «абонент говорит, оператор молчит» — локализация «RTP есть, голоса нет».
# Запуск на сервере во время звонка (после ответа агента):
#   sudo bash scripts/run-subscriber-audio-test.sh
#   AGENT_IP=192.168.1.103 sudo bash scripts/run-subscriber-audio-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."

AGENT_IP="${AGENT_IP:-192.168.1.103}"
WATCH="${WATCH:-8}"
PUBLIC_IP="${PUBLIC_DOMAIN:-172.16.6.183}"
GSM_UMG_TEST_IP="${GSM_UMG_TEST_IP:-10.1.5.72}"

if [[ -f .env ]]; then
  # shellcheck source=/dev/null
  source .env 2>/dev/null || true
  PUBLIC_IP="${PUBLIC_DOMAIN:-172.16.6.183}"
  GSM_UMG_TEST_IP="${GSM_UMG_TEST_IP:-10.1.5.72}"
fi

echo "=== Subscriber audio test protocol $(date -Is) ==="
echo ""
echo "Before running: agent answered, operator SILENT, subscriber SPEAKS for ${WATCH}s+"
echo ""
echo "=== 1. Full diagnosis (channelstats + optional tcpdump) ==="
if [[ "$(id -u)" -eq 0 ]]; then
  bash scripts/run-gsm-voice-diagnosis.sh -t "$WATCH"
else
  echo "(run as root for tcpdump: sudo bash $0)"
  bash scripts/run-gsm-voice-diagnosis.sh "$WATCH"
fi
echo ""
echo "=== 2. Leg2 quick capture (PBX -> agent) ==="
if [[ "$(id -u)" -eq 0 ]]; then
  timeout 8 tcpdump -ni enp6s0f0 src host "$PUBLIC_IP" and dst host "$AGENT_IP" and udp -c 30 2>&1 || true
else
  echo "  sudo tcpdump -ni enp6s0f0 src ${PUBLIC_IP} and dst ${AGENT_IP} and udp -c 30"
fi
echo ""
echo "=== 3. Latest MixMonitor recording ==="
REC="$(find /var/spool/asterisk/recordings -name '*.wav' -type f 2>/dev/null | sort -r | head -1 || true)"
if [[ -n "$REC" && -f "$REC" ]]; then
  ls -lh "$REC"
  echo "  Play on server: aplay \"$REC\"  (or scp to Windows)"
  echo "  If subscriber voice on recording -> browser/OS issue; if silent -> UMG/GSM"
else
  echo "  (no .wav found under /var/spool/asterisk/recordings)"
fi
echo ""
echo "=== 4. Browser (on agent PC) ==="
echo "  F12 -> [CC-RTP]: audioLevel and totalAudioEnergy should rise when subscriber speaks"
echo "  chrome://webrtc-internals -> inbound-rtp -> audioLevel"
echo "  document.getElementById('sip-remote-audio').volume  (should be 1)"
