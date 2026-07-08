#!/usr/bin/env bash
# Проверка портов перед native install (КЦ + SMSC на одном хосте)
set -uo pipefail

PORTS=(
  "5433:Postgres CC"
  "5432:Postgres (other/SMSC?)"
  "5060:SIP UDP/TCP"
  "5061:SIP TLS"
  "5038:Asterisk AMI"
  "8088:Asterisk HTTP"
  "8089:Asterisk WSS/TLS"
  "9000:Web UI"
  "9443:Web UI TLS"
  "3478:coturn TURN"
  "3001:Grafana CC"
  "9091:Prometheus CC"
  "3000:Grafana other?"
  "9090:Prometheus other?"
)

echo "=== Порты КЦ (ожидаемые) ==="
for entry in "${PORTS[@]}"; do
  port="${entry%%:*}"
  name="${entry#*:}"
  if command -v ss >/dev/null 2>&1; then
    if ss -tln | awk '{print $4}' | grep -qE ":${port}$"; then
      echo "  BUSY  TCP $port  ($name)"
      ss -tlnp | grep ":${port} " || true
    elif ss -uln | awk '{print $4}' | grep -qE ":${port}$"; then
      echo "  BUSY  UDP $port  ($name)"
    else
      echo "  free       $port  ($name)"
    fi
  else
    echo "  ?          $port  ($name) — install iproute2/ss"
  fi
done

echo ""
echo "=== CC systemd services ==="
for svc in cc-asterisk cc-webui cc-coturn prometheus grafana-server postgresql; do
  systemctl is-active "${svc}" 2>/dev/null && echo "  active  ${svc}" || echo "  down    ${svc}"
done

echo ""
echo "=== Disk / RAM ==="
df -h / | tail -1
free -h | head -2
