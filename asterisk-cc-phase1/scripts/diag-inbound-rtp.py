#!/usr/bin/env python3
import paramiko

HOST, USER, PASSWORD = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

cmds = [
    f"cd {REMOTE} && sh -c 'grep -E \"aba48e9a|918441995|Got RTP.*10\\.1\\.5|Got RTP.*192\\.168|Sent RTP.*192\\.168|Sent RTP.*10\\.1\\.5\" /var/log/asterisk/full 2>/dev/null | tail -50'",
    f"cd {REMOTE} && sh -c 'grep CC-TRACE /var/log/asterisk/full 2>/dev/null | tail -8'",
    "ip route get 192.168.1.103 2>/dev/null || true",
    f"cd {REMOTE} && asterisk -rx 'rtp show settings' 2>&1 | head -20",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
for cmd in cmds:
    print("\n===", cmd[:100], "\n")
    _, o, _ = c.exec_command(cmd, timeout=90)
    print(o.read().decode("utf-8", errors="replace").encode("ascii", errors="replace").decode()[:12000])
c.close()
