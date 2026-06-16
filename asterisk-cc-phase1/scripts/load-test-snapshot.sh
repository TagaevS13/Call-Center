#!/usr/bin/env bash
# Снимок метрик для нагрузочного теста (ops/load-test-300.md).
set -euo pipefail

TS="$(date -Is)"
HOST="$(hostname -s 2>/dev/null || hostname)"

echo "========== load-test-snapshot $TS $HOST =========="

if command -v docker >/dev/null 2>&1 && [[ -f docker-compose.yml ]]; then
  if docker compose ps asterisk-a 2>/dev/null | grep -q Up; then
    echo "--- asterisk (docker) ---"
    docker compose exec -T asterisk-a asterisk -rx "core show channels count" 2>/dev/null || true
    docker compose exec -T asterisk-a asterisk -rx "core show uptime" 2>/dev/null || true
    docker compose exec -T asterisk-a asterisk -rx "queue show" 2>/dev/null | head -25 || true
  fi
elif command -v asterisk >/dev/null 2>&1; then
  echo "--- asterisk (native) ---"
  asterisk -rx "core show channels count" 2>/dev/null || true
  asterisk -rx "core show uptime" 2>/dev/null || true
  asterisk -rx "queue show" 2>/dev/null | head -25 || true
fi

echo "--- system ---"
uptime
free -h 2>/dev/null | head -2 || true
df -h / /var/spool/asterisk/recordings 2>/dev/null | tail -n +1 || df -h / 2>/dev/null || true

if [[ -r /proc/loadavg ]]; then
  echo "loadavg: $(cat /proc/loadavg)"
fi

if command -v ss >/dev/null 2>&1; then
  echo "--- udp sockets (count) ---"
  ss -u -a 2>/dev/null | wc -l || true
fi

if command -v curl >/dev/null 2>&1; then
  METRICS=$(curl -sf http://127.0.0.1:9815/metrics 2>/dev/null || true)
  if [[ -n "$METRICS" ]]; then
    echo "--- asterisk_exporter ---"
    echo "$METRICS" | grep -E '^asterisk_core_active_channels ' || true
  fi
fi

echo "========== end =========="
