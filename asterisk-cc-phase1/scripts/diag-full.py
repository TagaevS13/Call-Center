#!/usr/bin/env python3
import paramiko

HOST, USER, PASSWORD = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

cmds = [
    f"cd {REMOTE} && systemctl is-active cc-asterisk cc-webui postgresql",
    f"cd {REMOTE} && journalctl -u cc-webui --tail 40 2>&1",
    f"cd {REMOTE} && journalctl -u cc-asterisk --tail 25 2>&1",
    f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c \"SELECT login, role, status FROM agents ORDER BY id;\"",
    "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9000/api/health",
    "curl -s http://127.0.0.1:9000/api/health",
    f"cd {REMOTE} && sh -c 'grep -E \"1263|INBOUND|Hangup|Playback|vdn-1263|from-provider\" /var/log/asterisk/full 2>/dev/null | tail -50'",
    f"cd {REMOTE} && asterisk -rx 'pjsip show endpoint provider'",
    f"cd {REMOTE} && asterisk -rx 'core show channels'",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
for cmd in cmds:
    print("\n===", cmd[:120], "===\n", flush=True)
    _, stdout, stderr = c.exec_command(cmd, timeout=90)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out:
        print(out[:8000])
    if err.strip():
        print("stderr:", err[:2000])
c.close()
