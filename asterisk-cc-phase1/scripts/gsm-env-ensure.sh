#!/usr/bin/env bash
# Дописать/обновить GSM-переменные в .env (раздельно сигналинг / медиа).
set -euo pipefail

ENV_FILE="${1:-.env}"

set_kv() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE"
  else
    echo "${k}=${v}" >> "$ENV_FILE"
  fi
}

[[ -f "$ENV_FILE" ]] || cp .env.example "$ENV_FILE" 2>/dev/null || touch "$ENV_FILE"

set_kv PUBLIC_DOMAIN 172.16.6.183
set_kv GSM_MEDIA_ADDRESS 10.212.154.35
set_kv GSM_SIGNAL_ADDRESS 172.16.4.19
set_kv SIP_PROVIDER_SIGNAL_NET 10.1.5.8/29
set_kv SIP_PROVIDER_MEDIA_NET 10.1.5.64/27
set_kv GSM_ROUTE_SIGNAL_NET 10.1.5.8/29
set_kv GSM_ROUTE_MEDIA_NET 10.1.5.64/27
set_kv GSM_ROUTE_SIGNAL_VIA 172.16.4.1
set_kv GSM_ROUTE_SIGNAL_DEV enp13s4f0
set_kv GSM_ROUTE_MEDIA_VIA 10.212.154.34
set_kv GSM_ROUTE_MEDIA_DEV enp13s4f1
set_kv GSM_UMG_TEST_IP 10.1.5.72

for legacy in SIP_PROVIDER_SIGNAL SIP_PROVIDER_MEDIA GSM_ROUTE_NET GSM_ROUTE_VIA GSM_ROUTE_DEV; do
  sed -i "/^${legacy}=/d" "$ENV_FILE" 2>/dev/null || true
done

echo "Updated $ENV_FILE (GSM split: signal .4.19/enp13s4f0, media 10.212.154.35/enp13s4f1)"
grep -E '^PUBLIC_DOMAIN=|^GSM_|^SIP_PROVIDER_' "$ENV_FILE"
