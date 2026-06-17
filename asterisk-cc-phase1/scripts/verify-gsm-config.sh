#!/usr/bin/env bash
# Проверка маршрутов и PJSIP identify для GSM (подсети /29 + /27, не /32).
set -euo pipefail

cd "$(dirname "$0")/.."
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

ok() { echo -e "${GREEN}OK${NC} $*"; }
fail() { echo -e "${RED}FAIL${NC} $*"; ERR=1; }

ERR=0

echo "=== GSM routes (expect /24, /29, /27 — no /32) ==="
if ip r | grep -q '10.1.5.8/29'; then ok "route 10.1.5.8/29"; else fail "missing 10.1.5.8/29"; fi
if ip r | grep -q '10.1.5.64/27'; then ok "route 10.1.5.64/27"; else fail "missing 10.1.5.64/27"; fi
if ip r | grep -q '10.1.5.0/24'; then ok "route 10.1.5.0/24"; else fail "missing 10.1.5.0/24 (optional but expected)"; fi
if ip r | grep -E '10\.1\.5\.(10|75)/32'; then
  fail "legacy /32 routes still present"
else
  ok "no legacy GSM /32 routes"
fi

echo ""
echo "=== .env (if present) ==="
if [[ -f .env ]]; then
  grep -E '^SIP_PROVIDER_|^GSM_ROUTE_' .env || true
  grep -q 'SIP_PROVIDER_SIGNAL_NET=10.1.5.8/29' .env && ok "SIP_PROVIDER_SIGNAL_NET" || fail "SIP_PROVIDER_SIGNAL_NET"
  grep -q 'SIP_PROVIDER_MEDIA_NET=10.1.5.64/27' .env && ok "SIP_PROVIDER_MEDIA_NET" || fail "SIP_PROVIDER_MEDIA_NET"
else
  echo "(no .env in cwd)"
fi

echo ""
echo "=== Asterisk PJSIP identify (docker) ==="
if docker compose ps asterisk-a 2>/dev/null | grep -q Up; then
  OUT=$(docker compose exec -T asterisk-a asterisk -rx "pjsip show identifies" 2>/dev/null || true)
  echo "$OUT" | grep -q '10.1.5.8/29' && ok "match 10.1.5.8/29" || fail "match 10.1.5.8/29"
  echo "$OUT" | grep -q '10.1.5.64/27' && ok "match 10.1.5.64/27" || fail "match 10.1.5.64/27"
  echo "$OUT" | grep -qE '10\.1\.5\.(10|75)/32' && fail "legacy /32 in identify" || ok "no /32 in identify"
  docker compose exec -T asterisk-a grep '^match=' /etc/asterisk/pjsip_provider.conf 2>/dev/null || true
else
  echo "asterisk-a not running — skip container checks"
fi

echo ""
if [[ "${ERR}" -eq 0 ]]; then
  echo -e "${GREEN}GSM config check passed${NC}"
else
  echo -e "${RED}GSM config check failed${NC}"
  exit 1
fi
