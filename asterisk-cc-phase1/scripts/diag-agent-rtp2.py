#!/usr/bin/env python3
import paramiko

HOST, USER, PASSWORD = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

cmds = [
    f"cd {REMOTE} && systemctl is-active cc-coturn cc-asterisk 2>&1",
    "ss -ulnp | grep -E '3478|10492|10000' | head -15",
    f"cd {REMOTE} && sh -c 'grep \"192.168.1.103\" /var/log/asterisk/full 2>/dev/null | tail -25'",
    f"cd {REMOTE} && sh -c 'grep -E \"Sent RTP.*192\\.168|Got RTP\" /var/log/asterisk/full 2>/dev/null | tail -25'",
    f"grep CC_RTP_DEBUG {REMOTE}/.env 2>/dev/null; grep AGENT_WEBRTC {REMOTE}/.env 2>/dev/null",
    f"cd {REMOTE} && asterisk -rx 'pjsip show channelstats'",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
for cmd in cmds:
    print("\n===", cmd[:110], "\n")
    _, o, e = c.exec_command(cmd, timeout=90)
    out = o.read().decode("utf-8", errors="replace")
    print(out.encode("ascii", errors="replace").decode()[:10000] or "(empty)")
c.close()
