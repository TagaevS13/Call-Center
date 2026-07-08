#!/usr/bin/env bash
# Диагностика «нет голоса в Web UI» — план gsm_voice_diagnosis.
# Запускать НА СЕРВЕРЕ во время тестового звонка (1263 → агент).
#   bash scripts/run-gsm-voice-diagnosis.sh 8
#   sudo bash scripts/run-gsm-voice-diagnosis.sh -t 8   # + tcpdump leg1 + leg2
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

TCPDUMP=0
if [[ "${1:-}" == "-t" ]]; then
  TCPDUMP=1
  shift
fi
WATCH="${1:-8}"
AGENT_IP="${AGENT_IP:-192.168.1.103}"
GSM_MEDIA_IFACE="${GSM_ROUTE_MEDIA_DEV:-enp13s4f1}"
GSM_MEDIA_IP="${GSM_MEDIA_ADDRESS:-10.212.154.35}"
AGENT_IFACE="${AGENT_IFACE:-enp6s0f0}"
PUBLIC_IP="${PUBLIC_DOMAIN:-172.16.6.183}"
GSM_UMG_TEST_IP="${GSM_UMG_TEST_IP:-10.1.5.72}"
LOG_TAIL_BYTES="${LOG_TAIL_BYTES:-3000000}"

if [[ -f .env ]]; then
  # shellcheck source=/dev/null
  source .env 2>/dev/null || true
  GSM_MEDIA_IFACE="${GSM_ROUTE_MEDIA_DEV:-enp13s4f1}"
  GSM_MEDIA_IP="${GSM_MEDIA_ADDRESS:-10.212.154.35}"
  PUBLIC_IP="${PUBLIC_DOMAIN:-172.16.6.183}"
  GSM_UMG_TEST_IP="${GSM_UMG_TEST_IP:-10.1.5.72}"
fi

# Отчёт: каталог проекта (избегаем Permission denied на /tmp от другого пользователя)
REPORT_DIR="${PROJECT_ROOT}/reports"
mkdir -p "$REPORT_DIR" 2>/dev/null || true
if [[ -w "$REPORT_DIR" ]]; then
  REPORT="${REPORT_DIR}/gsm-voice-diagnosis-$(date +%Y%m%d-%H%M%S).txt"
else
  REPORT="$(mktemp /tmp/gsm-voice-diagnosis.XXXXXX.txt)"
fi

LEG1_IN=0
LEG1_OUT=0
LEG2_CNT=0

_run_tcpdump_leg1() {
  local iface="${1:-enp13s4f1}"
  local net="${2:-10.1.5.64/27}"
  local media_ip="${3:-10.212.154.35}"
  local secs="${4:-8}"
  local cap="${5:-40}"
  echo "=== TCPDUMP leg1 (${secs}s, ${iface} net ${net}, media ${media_ip}) ==="
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "(skip: run with sudo for tcpdump)"
    return 0
  fi
  local tmp
  tmp=$(mktemp)
  timeout "$secs" tcpdump -ni "$iface" net "$net" and udp -c "$cap" 2>&1 | tee "$tmp" || true
  LEG1_IN=$(grep -cE "> ${media_ip//./\\.}\\." "$tmp" 2>/dev/null || true)
  LEG1_OUT=$(grep -cE "${media_ip//./\\.}\\.[0-9]+ >" "$tmp" 2>/dev/null || true)
  LEG1_IN=$((LEG1_IN + 0))
  LEG1_OUT=$((LEG1_OUT + 0))
  rm -f "$tmp"
  echo "LEG1 tcpdump summary: In=${LEG1_IN} Out=${LEG1_OUT}"
  if [[ "$LEG1_IN" -eq 0 && "$LEG1_OUT" -gt 0 ]]; then
    echo "VERDICT leg1: only Out — GSM not sending return RTP (ACL/UMG/preconditions)"
  elif [[ "$LEG1_IN" -gt 0 ]]; then
    echo "VERDICT leg1: In present — GSM RTP reaches PBX"
  else
    echo "VERDICT leg1: no packets (no active call during capture?)"
  fi
}

_run_tcpdump_leg2() {
  local iface="${1:-enp6s0f0}"
  local src_ip="${2:-172.16.6.183}"
  local dst_ip="${3:-192.168.1.103}"
  local cap="${4:-30}"
  echo "=== TCPDUMP leg2 (PBX -> agent, ${iface} src ${src_ip} dst ${dst_ip}) ==="
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "(skip: run with sudo for tcpdump)"
    return 0
  fi
  local tmp
  tmp=$(mktemp)
  timeout 8 tcpdump -ni "$iface" src host "$src_ip" and dst host "$dst_ip" and udp -c "$cap" 2>&1 | tee "$tmp" || true
  LEG2_CNT=$(grep -cE 'UDP, length' "$tmp" 2>/dev/null || true)
  LEG2_CNT=$((LEG2_CNT + 0))
  rm -f "$tmp"
  echo "LEG2 tcpdump summary: packets=${LEG2_CNT}"
  if [[ "$LEG2_CNT" -gt 0 ]]; then
    echo "VERDICT leg2: PBX sends UDP toward agent"
  else
    echo "VERDICT leg2: no PBX->agent UDP (no call / wrong AGENT_IP / FW)"
  fi
}

_ast_active() {
  systemctl is-active cc-asterisk 2>/dev/null | grep -qE '^(active|activating)$' \
    || systemctl is-active asterisk 2>/dev/null | grep -qE '^(active|activating)$' \
    || command -v asterisk >/dev/null 2>&1
}

{
  echo "=== GSM voice diagnosis $(date -Is) ==="
  echo "GSM media: ${GSM_MEDIA_IP} dev ${GSM_MEDIA_IFACE}; WebRTC: ${PUBLIC_IP} dev ${AGENT_IFACE}"
  echo "Report: ${REPORT}"
  echo ""

  echo "=== Routes ==="
  ip r | grep 10.1.5 || echo "(no 10.1.5 routes)"
  ip route get 10.1.5.10 2>/dev/null || true
  ip route get "${GSM_UMG_TEST_IP}" 2>/dev/null || true
  echo ""

  echo "=== verify-gsm-config ==="
  bash scripts/verify-gsm-config.sh 2>&1 || true
  echo ""

  echo "=== diag-audio (-w ${WATCH}) ==="
  bash scripts/diag-audio.sh -w "$WATCH" 2>&1 || true
  echo ""

  echo "=== Got RTP from GSM (tail -c ${LOG_TAIL_BYTES}, last 10) ==="
  if _ast_active; then
    tail -c "$LOG_TAIL_BYTES" /var/log/asterisk/full 2>/dev/null \
      | grep -a "Got  RTP packet from    10.1.5" | tail -10 || echo "(none — enable CC_RTP_DEBUG=1 for verbose RTP log)"
  else
    echo "asterisk not running (cc-asterisk / asterisk)"
  fi
  echo ""

  echo "=== Got RTP from agent WebRTC (${PUBLIC_IP} in Asterisk log, last 5) ==="
  if _ast_active; then
    tail -c "$LOG_TAIL_BYTES" /var/log/asterisk/full 2>/dev/null \
      | grep -a "Got  RTP packet from    ${PUBLIC_IP}" | tail -5 || echo "(none — CC_RTP_DEBUG=0 or agent silent)"
  fi
  echo ""

  echo "=== CC-TRACE last inbound 1263 ==="
  if _ast_active; then
    tail -c "$LOG_TAIL_BYTES" /var/log/asterisk/full 2>/dev/null \
      | grep -a "CC-TRACE.*1263" | tail -5 || echo "(none)"
  fi
  echo ""

  if [[ "$TCPDUMP" -eq 1 ]]; then
    _run_tcpdump_leg1 "$GSM_MEDIA_IFACE" 10.1.5.64/27 "$GSM_MEDIA_IP" 8 40
    echo ""
    _run_tcpdump_leg2 "$AGENT_IFACE" "$PUBLIC_IP" "$AGENT_IP" 30
    echo ""
  fi

  echo "=== Combined verdict ==="
  if [[ "$TCPDUMP" -eq 0 ]]; then
    echo "During call: sudo bash $0 -t ${WATCH}"
  else
    if [[ "$LEG1_IN" -gt 0 && "$LEG2_CNT" -gt 0 ]]; then
      echo "RTP path OK on network (leg1 In + leg2 PBX->agent)."
      echo "If subscriber still inaudible: check browser [CC-RTP] audioLevel, MixMonitor wav, UMG payload."
    elif [[ "$LEG1_IN" -eq 0 && "$LEG1_OUT" -gt 0 ]]; then
      echo "GSM one-way: escalate UMG/ACL for 10.1.5.64/27 -> ${GSM_MEDIA_IP}"
    elif [[ "$LEG1_IN" -gt 0 && "$LEG2_CNT" -eq 0 ]]; then
      echo "GSM OK but leg2 missing: FW ${PUBLIC_IP} -> ${AGENT_IP} or wrong AGENT_IP"
    else
      echo "Inconclusive — run during active call; see diag-audio section 5"
    fi
  fi
  echo ""
  echo "=== LEG2 hint (Asterisk -> agent ${AGENT_IP}) ==="
  echo "Browser [CC-RTP]: in= grows but no voice -> check audioLevel, not only bytesReceived"
  echo "  sudo tcpdump -ni ${AGENT_IFACE} src ${PUBLIC_IP} and dst ${AGENT_IP} and udp -c 30"
  echo "  MixMonitor: ls -lt /var/spool/asterisk/recordings/*/*/*.wav | head -3"
} | tee "$REPORT"

echo ""
echo "Report saved: $REPORT"
