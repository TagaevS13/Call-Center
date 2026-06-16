#!/usr/bin/env python3
"""List all Boss4 Param names from live response (run on server via SSH)."""
import os
import paramiko

HOST = "172.16.6.183"
USER = "sorbon"
PASSWORD = os.environ["CC_DEPLOY_PASS"]
REMOTE = "/opt/call-center/asterisk-cc-phase1"
MSISDN = os.environ.get("BOSS4_TEST_MSISDN", "918441995")

REMOTE_PY = r'''
import json
import sys
sys.path.insert(0, "/app")
from crm_engine import boss4_lookup

connector = {
    "name": "Boss4",
    "connector_type": "soap",
    "config": {
        "service_url": "http://172.16.2.62:80/axis2/services/Boss4UnifiedInterfaceService",
        "operation_id": "10017",
        "timeout": 30,
    },
    "field_mapping": {},
}
profile = boss4_lookup(sys.argv[1], connector)
params = profile.get("crm_raw") or {}
print(json.dumps({"count": len(params), "params": params}, ensure_ascii=False, indent=2))
'''


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    cmd = (
        f"cd {REMOTE} && docker compose exec -T webui "
        f'python -c {repr(REMOTE_PY)} {MSISDN}'
    )
    _, o, e = c.exec_command(cmd, timeout=90)
    out = (o.read() + e.read()).decode("utf-8", errors="replace")
    print(out)
    c.close()


if __name__ == "__main__":
    main()
