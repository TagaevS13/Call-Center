#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
REMOTE = "/opt/call-center/asterisk-cc-phase1"
cmds = [
    f"cd {REMOTE} && sh -c 'grep C-00000009 /var/log/asterisk/full | grep -E \"Sent RTP|Got RTP\" | head -5'",
    f"cd {REMOTE} && sh -c 'grep C-00000009 /var/log/asterisk/full | grep \"Sent RTP\" | tail -10'",
    f"cd {REMOTE} && sh -c 'grep C-00000009 /var/log/asterisk/full | grep \"Got RTP.*10\\.1\\.5\" | tail -10'",
    f"cd {REMOTE} && sh -c 'grep C-00000009 /var/log/asterisk/full | grep -E \"10492|61970\" | tail -15'",
]
for cmd in cmds:
    print("\n---\n")
    _, o, _ = c.exec_command(cmd, timeout=60)
    print(o.read().decode("ascii", errors="replace")[:8000] or "(empty)")
c.close()
