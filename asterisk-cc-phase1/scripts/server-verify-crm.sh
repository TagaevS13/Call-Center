#!/bin/bash
# Run ON SERVER after uploading webui files
set -e
cd /opt/call-center/asterisk-cc-phase1

echo "=== Check files ==="
for f in webui/cc_api.py webui/crm_api.py webui/crm_engine.py webui/ops_api.py webui/data/crm_connectors.json; do
  test -f "$f" && echo "OK $f" || echo "MISSING $f"
done

grep -q crm-connectors webui/cc_api.py && echo "OK cc_api has crm routes" || echo "FAIL cc_api OLD - upload webui/cc_api.py"

cd /opt/call-center/asterisk-cc-phase1/webui && pip install -q -r requirements.txt
cd /opt/call-center/asterisk-cc-phase1/webui && python seed_admin.py data
systemctl restart cc-webui
sleep 8

echo "=== API ==="
curl -s http://127.0.0.1:9000/api/health
echo ""
curl -s http://127.0.0.1:9000/api/admin/crm-connectors | head -c 500
echo ""
curl -s "http://127.0.0.1:9000/api/subscribers/918441995" | head -c 500
echo ""
