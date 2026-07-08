#!/usr/bin/env python3
import paramiko

HOST, USER, PASSWORD = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

SQL = """
-- fix sequence after manual ids
SELECT setval('vdn_routes_id_seq', (SELECT COALESCE(MAX(id), 1) FROM vdn_routes));
INSERT INTO vdn_routes (number, name, description, route_type, skill_queue_id, queue_name, enabled)
SELECT '1263', 'GSM 1263', 'Inbound GSM DID', 'queue_direct', q.id, 'russkaya', true
FROM queues q WHERE q.name = 'russkaya' LIMIT 1
ON CONFLICT (number) DO UPDATE SET
  route_type = EXCLUDED.route_type,
  queue_name = EXCLUDED.queue_name,
  skill_queue_id = EXCLUDED.skill_queue_id,
  enabled = true,
  updated_at = now();
SELECT id, number, route_type, queue_name, enabled FROM vdn_routes ORDER BY number;
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
cmd = f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc <<'EOSQL'\n{SQL}\nEOSQL"
_, o, e = c.exec_command(cmd, timeout=90)
print(o.read().decode("utf-8", errors="replace").encode("ascii", errors="replace").decode())
print(e.read().decode())

for cmd in [
    f"cd {REMOTE} && cd /opt/call-center/asterisk-cc-phase1/webui && python3 cc_config_sync.py --etc /asterisk-etc --no-reload",
    f"cd {REMOTE} && asterisk -rx 'dialplan reload'",
    f"cd {REMOTE} && asterisk -rx 'dialplan show vdn-route'",
]:
    _, o, _ = c.exec_command(cmd, timeout=60)
    print(o.read().decode("ascii", errors="replace")[:3000])
c.close()
