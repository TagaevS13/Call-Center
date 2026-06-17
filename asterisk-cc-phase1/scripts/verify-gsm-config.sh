#!/usr/bin/env bash
# Проверка split-маршрутов GSM и PJSIP media_address.
set -euo pipefail

cd "$(dirname "$0")/.."
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

ok() { echo -e "${GREEN}OK${NC} $*"; }
fail() { echo -e "${RED}FAIL${NC} $*"; ERR=1; }

ERR=0

echo "=== GSM split routes ==="
if ip r | grep -q '10.1.5.8/29.*enp13s4f0'; then ok "signal 10.1.5.8/29 via enp13s4f0"; else fail "signal route not via enp13s4f0"; fi
if ip r | grep -q '10.1.5.64/27.*enp6s0f0'; then ok "media 10.1.5.64/27 via enp6s0f0"; else fail "media route not via enp6s0f0"; fi
if ip r | grep -qE '10\.1\.5\.64/27.*enp13s4f0'; then fail "media /27 still via enp13s4f0"; else ok "no media /27 via enp13s4f0"; fi
if ip r | grep -E '10\.1\.5\.(10|75)/32'; then fail "legacy /32 routes"; else ok "no legacy /32"; fi

echo ""
echo "=== .env ==="
if [[ -f .env ]]; then
  grep -E '^GSM_|^SIP_PROVIDER_|^PUBLIC_DOMAIN=' .env || true
  grep -q 'GSM_MEDIA_ADDRESS=172.16.6.183' .env && ok "GSM_MEDIA_ADDRESS=.6.183" || fail "GSM_MEDIA_ADDRESS"
  grep -q 'GSM_SIGNAL_ADDRESS=172.16.4.19' .env && ok "GSM_SIGNAL_ADDRESS=.4.19" || fail "GSM_SIGNAL_ADDRESS"
else
  echo "(no .env)"
fi

echo ""
echo "=== Asterisk PJSIP (docker) ==="
if docker compose ps asterisk-a 2>/dev/null | grep -q Up; then
  OUT=$(docker compose exec -T asterisk-a asterisk -rx "pjsip show identifies" 2>/dev/null || true)
  echo "$OUT" | grep -q '10.1.5.8/29' && ok "match 10.1.5.8/29" || fail "match signal"
  echo "$OUT" | grep -q '10.1.5.64/27' && ok "match 10.1.5.64/27" || fail "match media"
  MA=$(docker compose exec -T asterisk-a grep '^media_address=' /etc/asterisk/pjsip_provider.conf 2>/dev/null || true)
  echo "$MA"
  echo "$MA" | grep -q 'media_address=172.16.6.183' && ok "media_address=172.16.6.183" || fail "media_address not .6.183"
else
  echo "asterisk-a not running"
fi

echo ""
if [[ "${ERR}" -eq 0 ]]; then
  echo -e "${GREEN}GSM config check passed${NC}"
else
  echo -e "${RED}GSM config check failed${NC}"
  exit 1
fi
