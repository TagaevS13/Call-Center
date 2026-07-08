#!/usr/bin/env bash
# Проверка split-маршрутов GSM и PJSIP (подсети /29 + /27).
set -euo pipefail

cd "$(dirname "$0")/.."
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

ok() { echo -e "${GREEN}OK${NC} $*"; }
fail() { echo -e "${RED}FAIL${NC} $*"; ERR=1; }

ERR=0
GSM_MEDIA_NET="${GSM_ROUTE_MEDIA_NET:-10.1.5.64/27}"
GSM_MEDIA_VIA="${GSM_ROUTE_MEDIA_VIA:-10.212.154.34}"
GSM_MEDIA_DEV="${GSM_ROUTE_MEDIA_DEV:-enp13s4f1}"
GSM_MEDIA_IP="${GSM_MEDIA_ADDRESS:-10.212.154.35}"
PUBLIC_IP="${PUBLIC_DOMAIN:-172.16.6.183}"
GSM_UMG_TEST_IP="${GSM_UMG_TEST_IP:-10.1.5.72}"

if [[ -f .env ]]; then
  # shellcheck source=/dev/null
  source .env 2>/dev/null || true
  GSM_MEDIA_NET="${GSM_ROUTE_MEDIA_NET:-10.1.5.64/27}"
  GSM_MEDIA_VIA="${GSM_ROUTE_MEDIA_VIA:-10.212.154.34}"
  GSM_MEDIA_DEV="${GSM_ROUTE_MEDIA_DEV:-enp13s4f1}"
  GSM_MEDIA_IP="${GSM_MEDIA_ADDRESS:-10.212.154.35}"
  PUBLIC_IP="${PUBLIC_DOMAIN:-172.16.6.183}"
  GSM_UMG_TEST_IP="${GSM_UMG_TEST_IP:-10.1.5.72}"
fi

echo "=== GSM split routes ==="
if ip r | grep -q "10.1.5.8/29.*172.16.4.1.*enp13s4f0"; then
  ok "signal 10.1.5.8/29 via 172.16.4.1 enp13s4f0"
else
  fail "signal 10.1.5.8/29 not via 172.16.4.1 enp13s4f0"
fi
if ip r | grep -q "10.1.5.64/27.*${GSM_MEDIA_VIA}.*${GSM_MEDIA_DEV}"; then
  ok "media 10.1.5.64/27 via ${GSM_MEDIA_VIA} ${GSM_MEDIA_DEV}"
else
  fail "media 10.1.5.64/27 not via ${GSM_MEDIA_VIA} ${GSM_MEDIA_DEV}"
fi
if ip r | grep -qE '10\.1\.5\.0/24'; then fail "stale route 10.1.5.0/24 present"; else ok "no blanket 10.1.5.0/24"; fi
if ip r | grep -E '10\.1\.5\.(10|72|75)/32'; then fail "legacy /32 routes"; else ok "no legacy /32"; fi
if ip r | grep -q '10.1.5.8/29.*172.16.6.131'; then fail "signal /29 wrongly via 172.16.6.131"; else ok "signal not via media GW"; fi
if ip r | grep -q '10.1.5.64/27.*172.16.4.1'; then fail "media /27 wrongly via 172.16.4.1"; else ok "media not via signal GW"; fi
if ip r | grep -q '10.1.5.64/27.*172.16.6.131.*enp6s0f0'; then fail "stale media route via enp6s0f0"; else ok "no stale media via enp6s0f0"; fi

echo ""
echo "=== route get ==="
SIG_GET=$(ip route get 10.1.5.10 2>/dev/null || true)
MED_GET=$(ip route get "${GSM_UMG_TEST_IP}" 2>/dev/null || true)
echo "$SIG_GET"
echo "$MED_GET"
echo "$SIG_GET" | grep -q '172.16.4.1.*enp13s4f0' && ok "10.1.5.10 via signal path" || fail "10.1.5.10 route"
echo "$MED_GET" | grep -q "${GSM_MEDIA_VIA}.*${GSM_MEDIA_DEV}" && ok "${GSM_UMG_TEST_IP} via media path (${GSM_MEDIA_NET})" || fail "${GSM_UMG_TEST_IP} route"

echo ""
echo "=== .env ==="
if [[ -f .env ]]; then
  grep -E '^GSM_|^SIP_PROVIDER_|^PUBLIC_DOMAIN=' .env || true
  grep -q "GSM_MEDIA_ADDRESS=${GSM_MEDIA_IP}" .env && ok "GSM_MEDIA_ADDRESS=${GSM_MEDIA_IP}" || fail "GSM_MEDIA_ADDRESS"
  grep -q 'GSM_SIGNAL_ADDRESS=172.16.4.19' .env && ok "GSM_SIGNAL_ADDRESS=.4.19" || fail "GSM_SIGNAL_ADDRESS"
  grep -q 'GSM_ROUTE_SIGNAL_VIA=172.16.4.1' .env && ok "GSM_ROUTE_SIGNAL_VIA=.4.1" || fail "GSM_ROUTE_SIGNAL_VIA"
  grep -q "GSM_ROUTE_MEDIA_VIA=${GSM_MEDIA_VIA}" .env && ok "GSM_ROUTE_MEDIA_VIA=${GSM_MEDIA_VIA}" || fail "GSM_ROUTE_MEDIA_VIA"
  grep -q "GSM_ROUTE_MEDIA_DEV=${GSM_MEDIA_DEV}" .env && ok "GSM_ROUTE_MEDIA_DEV=${GSM_MEDIA_DEV}" || fail "GSM_ROUTE_MEDIA_DEV"
  grep -q "GSM_UMG_TEST_IP=${GSM_UMG_TEST_IP}" .env && ok "GSM_UMG_TEST_IP=${GSM_UMG_TEST_IP}" || fail "GSM_UMG_TEST_IP"
else
  echo "(no .env)"
fi

echo ""
echo "=== Asterisk PJSIP (native) ==="
AST_ACTIVE=0
if systemctl is-active cc-asterisk >/dev/null 2>&1; then
  AST_ACTIVE=1
elif systemctl is-active asterisk >/dev/null 2>&1; then
  AST_ACTIVE=1
fi
if [[ "$AST_ACTIVE" -eq 1 ]]; then
  OUT=$(asterisk -rx "pjsip show identifies" 2>/dev/null || true)
  echo "$OUT" | grep -q '10.1.5.8/29' && ok "match 10.1.5.8/29 (signal subnet)" || fail "match signal"
  echo "$OUT" | grep -q '10.1.5.64/27' && ok "match 10.1.5.64/27 (media subnet)" || fail "match media"
  MA=$(grep '^media_address=' /etc/asterisk/pjsip_provider.conf 2>/dev/null || true)
  echo "$MA"
  echo "$MA" | grep -q "media_address=${GSM_MEDIA_IP}" && ok "media_address=${GSM_MEDIA_IP}" || fail "media_address not ${GSM_MEDIA_IP}"
  RTP_CONF=$(grep -E '^external_media_address=|^localnet=' /etc/asterisk/rtp.conf 2>/dev/null || true)
  echo "$RTP_CONF"
  echo "$RTP_CONF" | grep -q "external_media_address=${PUBLIC_IP}" && ok "rtp external_media_address=${PUBLIC_IP}" || fail "rtp external_media_address"
  echo "$RTP_CONF" | grep -q 'localnet=10.0.0.0/8' && fail "stale localnet=10.0.0.0/8 in rtp.conf" || ok "no stale 10.0.0.0/8 localnet"
  PJSIP_EXT=$(grep '^external_media_address=' /etc/asterisk/pjsip.conf 2>/dev/null || true)
  echo "$PJSIP_EXT"
  echo "$PJSIP_EXT" | grep -q "external_media_address=${PUBLIC_IP}" && ok "pjsip external_media_address=${PUBLIC_IP}" || fail "pjsip external_media_address"
  echo "$PJSIP_EXT" | grep -q '\${' && fail "unsubstituted \${...} in pjsip.conf" || ok "pjsip vars substituted"
  echo ""
  echo "=== RTP from GSM media subnet (any host in ${GSM_MEDIA_NET}) ==="
  RTP=$(grep "Got  RTP packet from    10.1.5" /var/log/asterisk/full 2>/dev/null | tail -3 || true)
  if [[ -n "$RTP" ]]; then
    ok "recent RTP from 10.1.5.x (media subnet)"
    echo "$RTP"
  else
    echo "(no RTP from 10.1.5.x in log yet — check during active call)"
  fi
else
  echo "asterisk not running"
fi

echo ""
if [[ "$ERR" -eq 0 ]]; then
  ok "GSM config check passed"
else
  fail "GSM config check failed"
  exit 1
fi
