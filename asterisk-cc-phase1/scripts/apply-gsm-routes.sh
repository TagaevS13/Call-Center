#!/usr/bin/env bash
# Split-маршруты GSM:
#   сигналинг 10.1.5.8/29  → 172.16.4.1      / enp13s4f0  (SIP bind 172.16.4.19)
#   медиа     10.1.5.64/27 → 10.212.154.34  / enp13s4f1  (RTP bind 10.212.154.35)
set -euo pipefail

GSM_SIGNAL_NET="${GSM_ROUTE_SIGNAL_NET:-10.1.5.8/29}"
GSM_MEDIA_NET="${GSM_ROUTE_MEDIA_NET:-10.1.5.64/27}"
GSM_SIGNAL_VIA="${GSM_ROUTE_SIGNAL_VIA:-172.16.4.1}"
GSM_SIGNAL_DEV="${GSM_ROUTE_SIGNAL_DEV:-enp13s4f0}"
GSM_MEDIA_VIA="${GSM_ROUTE_MEDIA_VIA:-10.212.154.34}"
GSM_MEDIA_DEV="${GSM_ROUTE_MEDIA_DEV:-enp13s4f1}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run: sudo bash $0" >&2
  exit 1
fi

for dev in "$GSM_SIGNAL_DEV" "$GSM_MEDIA_DEV"; do
  if ! ip link show "$dev" &>/dev/null; then
    echo "Interface $dev not found" >&2
    exit 1
  fi
done

# Убрать устаревшие /32, blanket /24 и wrong-split маршруты
for stale in 10.1.5.10/32 10.1.5.72/32 10.1.5.75/32; do
  while ip route del "$stale" 2>/dev/null; do :; done
done
while ip route del 10.1.5.0/24 2>/dev/null; do :; done
while ip route del "${GSM_SIGNAL_NET}" via 172.16.6.131 dev enp6s0f0 2>/dev/null; do :; done
while ip route del "${GSM_MEDIA_NET}" via 172.16.4.1 dev enp13s4f0 2>/dev/null; do :; done
while ip route del "${GSM_MEDIA_NET}" via 172.16.6.131 dev enp6s0f0 2>/dev/null; do :; done

ip route replace "${GSM_SIGNAL_NET}" via "${GSM_SIGNAL_VIA}" dev "${GSM_SIGNAL_DEV}"
ip route replace "${GSM_MEDIA_NET}" via "${GSM_MEDIA_VIA}" dev "${GSM_MEDIA_DEV}"

sysctl -w net.ipv4.conf.all.rp_filter=2 >/dev/null 2>&1 || true
sysctl -w net.ipv4.conf."${GSM_SIGNAL_DEV}".rp_filter=2 >/dev/null 2>&1 || true
sysctl -w net.ipv4.conf."${GSM_MEDIA_DEV}".rp_filter=2 >/dev/null 2>&1 || true

echo "OK signal: ${GSM_SIGNAL_NET} via ${GSM_SIGNAL_VIA} dev ${GSM_SIGNAL_DEV}"
echo "OK media:  ${GSM_MEDIA_NET} via ${GSM_MEDIA_VIA} dev ${GSM_MEDIA_DEV}"
ip r | grep -E '10\.1\.5\.(8/29|64/27)' || true
