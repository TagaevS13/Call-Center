#!/usr/bin/env python3
"""Restore VDN 1263 and reload dialplan."""
import paramiko

HOST, USER, PASSWORD = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

SQL = r"""
INSERT INTO vdn_routes (number, name, description, route_type, skill_queue_id, queue_name, enabled)
SELECT '1263', 'GSM 1263', 'Входящий GSM DID', 'queue_direct', id, 'russkaya', true
FROM queues WHERE name = 'russkaya' LIMIT 1
ON CONFLICT (number) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  route_type = EXCLUDED.route_type,
  skill_queue_id = EXCLUDED.skill_queue_id,
  queue_name = EXCLUDED.queue_name,
  enabled = true,
  updated_at = now();
SELECT id, number, route_type, queue_name, enabled FROM vdn_routes ORDER BY number;
"""

cmds = [
    f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c \"{SQL}\"",
    f"cd {REMOTE} && cd /opt/call-center/asterisk-cc-phase1/webui && python3 cc_config_sync.py --etc /asterisk-etc --no-reload",
    f"cd {REMOTE} && asterisk -rx 'dialplan reload'",
    f"cd {REMOTE} && asterisk -rx 'dialplan show vdn-route'",
    f"grep -A12 'vdn-1263-direct' {REMOTE}/asterisk/etc/vdn_generated.conf",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
for cmd in cmds:
    print("\n>>>", cmd[:100], flush=True)
    _, o, e = c.exec_command(cmd, timeout=90)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    print(out.encode("ascii", errors="replace").decode("ascii")[:8000])
    if err.strip():
        print("ERR:", err[:500])
c.close()
print("\nDone: VDN 1263 restored")
