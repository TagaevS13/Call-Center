#!/usr/bin/env python3
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
REMOTE = "/opt/call-center/asterisk-cc-phase1"
cmds = [
    f"cat {REMOTE}/asterisk/etc/vdn_generated.conf",
    f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c \"SELECT id, number, route_type, queue_name, enabled FROM vdn_routes ORDER BY number;\"",
    f"cd {REMOTE} && sh -c 'grep 1781760223 /var/log/asterisk/full 2>/dev/null | tail -60'",
    f"cd {REMOTE} && asterisk -rx 'dialplan show vdn-route'",
]
for cmd in cmds:
    print("\n==========\n", flush=True)
    _, o, _ = c.exec_command(cmd, timeout=90)
    text = o.read().decode("utf-8", errors="replace")
    print(text.encode("ascii", errors="replace").decode("ascii")[:15000])
c.close()
