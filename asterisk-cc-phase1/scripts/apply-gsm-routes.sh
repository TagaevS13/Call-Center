#!/usr/bin/env bash
# Маршруты к GSM через enp13s4f0 (172.16.4.1):
#   10.1.5.0/24 (общий), плюс 10.1.5.8/29 (сигнал), 10.1.5.64/27 (медиа)
set -euo pipefail

GSM_NET="${GSM_ROUTE_NET:-10.1.5.0/24}"
GSM_SIGNAL_NET="${GSM_ROUTE_SIGNAL_NET:-10.1.5.8/29}"
GSM_MEDIA_NET="${GSM_ROUTE_MEDIA_NET:-10.1.5.64/27}"
GSM_VIA="${GSM_ROUTE_VIA:-172.16.4.1}"
GSM_DEV="${GSM_ROUTE_DEV:-enp13s4f0}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run: sudo bash $0" >&2
  exit 1
fi

if ! ip link show "$GSM_DEV" &>/dev/null; then
  echo "Interface $GSM_DEV not found" >&2
  exit 1
fi

# Убрать устаревшие /32 (GSM: только подсети /29 и /27)
for stale in 10.1.5.10/32 10.1.5.75/32; do
  while ip route del "$stale" 2>/dev/null; do :; done
done

# Подсети GSM только через enp13s4f0, не через default 172.16.6.131 / enp6s0f0
for net in "$GSM_NET" "$GSM_SIGNAL_NET" "$GSM_MEDIA_NET"; do
  ip route replace "$net" via "$GSM_VIA" dev "$GSM_DEV"
done

# Слабый rp_filter — иначе RTP 4.19↔10.1.5.64/27 режется при асимметрии
sysctl -w net.ipv4.conf.all.rp_filter=2 >/dev/null 2>&1 || true
sysctl -w net.ipv4.conf."$GSM_DEV".rp_filter=2 >/dev/null 2>&1 || true

echo "OK gsm:    $GSM_NET via $GSM_VIA dev $GSM_DEV"
echo "OK signal: $GSM_SIGNAL_NET via $GSM_VIA dev $GSM_DEV"
echo "OK media:  $GSM_MEDIA_NET via $GSM_VIA dev $GSM_DEV"
ip r | grep -E '10\.1\.5\.(8/29|64/27|0/24)' || true
