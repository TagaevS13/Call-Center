#!/usr/bin/env python3
import paramiko

HOST, USER, PASSWORD = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

cmds = [
    f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c \"SELECT id, sip_user, full_name FROM agents;\"",
    f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c \"\\d cdr\"",
    f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c \"SELECT * FROM cdr ORDER BY 1 DESC LIMIT 5;\"",
    f"cd {REMOTE} && sh -c 'grep CC-TRACE /var/log/asterisk/full 2>/dev/null | tail -30'",
    f"cd {REMOTE} && sh -c 'grep INBOUND /var/log/asterisk/full 2>/dev/null | tail -20'",
    f"cd {REMOTE} && sh -c 'grep -E \"1263|from-provider|vdn-1263\" /var/log/asterisk/full 2>/dev/null | tail -40'",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
for cmd in cmds:
    print("\n===", cmd[:130], "===\n", flush=True)
    _, stdout, _ = c.exec_command(cmd, timeout=90)
    print(stdout.read().decode("utf-8", errors="replace")[:10000])
c.close()
