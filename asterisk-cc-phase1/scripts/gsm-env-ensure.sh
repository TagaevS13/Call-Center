#!/usr/bin/env bash
# Дописать/обновить GSM-переменные в .env (подсети /29 и /27, не /32).
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

set_kv SIP_PROVIDER_SIGNAL 10.1.5.10
set_kv SIP_PROVIDER_MEDIA 10.1.5.75
set_kv SIP_PROVIDER_SIGNAL_NET 10.1.5.8/29
set_kv SIP_PROVIDER_MEDIA_NET 10.1.5.64/27
set_kv GSM_ROUTE_NET 10.1.5.0/24
set_kv GSM_ROUTE_SIGNAL_NET 10.1.5.8/29
set_kv GSM_ROUTE_MEDIA_NET 10.1.5.64/27
set_kv GSM_ROUTE_VIA 172.16.4.1
set_kv GSM_ROUTE_DEV enp13s4f0

echo "Updated $ENV_FILE (GSM subnets)"
grep -E '^SIP_PROVIDER_|^GSM_ROUTE_' "$ENV_FILE"
