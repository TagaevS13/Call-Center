#!/usr/bin/env bash
set -euo pipefail
pkill -f asterisk_exporter 2>/dev/null || true
sleep 1
FLAGS="$1"
/var/spool/asterisk/asterisk_exporter \
  --web.listen-address=127.0.0.1:9817 \
  --asterisk.path=/usr/sbin/asterisk \
  ${FLAGS} > /tmp/t.log 2>&1 &
sleep 2
echo "--- log ---"
grep registered /tmp/t.log || cat /tmp/t.log
echo "--- http ---"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:9817/metrics || echo curl_fail
curl -s http://127.0.0.1:9817/metrics | head -5 || true
pkill -f '9817' 2>/dev/null || true
