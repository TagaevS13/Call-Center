#!/usr/bin/env python3
import paramiko

HOST, USER, PASSWORD = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

cmds = [
    f"cd {REMOTE} && asterisk -rx 'dialplan show vdn-1263-direct'",
    f"cd {REMOTE} && asterisk -rx 'dialplan show queue-enter'",
    f"cd {REMOTE} && asterisk -rx 'queue show russkaya'",
    f"grep -A20 '\\[russkaya\\]' {REMOTE}/asterisk/etc/queues_generated.conf | head -25",
    f"cd {REMOTE} && asterisk -rx 'pjsip show endpoints' 2>&1 | grep -E '1001|1002|Endpoint'",
    f"cd {REMOTE} && tail -400 /var/log/asterisk/full 2>&1 | tail -80",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
for cmd in cmds:
    print("\n===", cmd[:130], "===\n", flush=True)
    _, stdout, stderr = c.exec_command(cmd, timeout=90)
    print(stdout.read().decode("utf-8", errors="replace")[:8000])
c.close()
