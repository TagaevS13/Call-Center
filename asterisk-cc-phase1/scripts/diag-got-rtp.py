#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
REMOTE = "/opt/call-center/asterisk-cc-phase1"
cmds = [
    f"cd {REMOTE} && sh -c 'grep \"Got RTP\" /var/log/asterisk/full | tail -15'",
    f"cd {REMOTE} && sh -c 'grep C-00000008 /var/log/asterisk/full | grep \"Sent RTP.*192.168\" | tail -15'",
    f"cd {REMOTE} && sh -c 'grep C-00000008 /var/log/asterisk/full | grep \"Got RTP\" | tail -15'",
]
for cmd in cmds:
    print("\n---\n")
    _, o, _ = c.exec_command(cmd, timeout=60)
    t = o.read().decode("utf-8", errors="replace")
    print(t.encode("ascii", errors="replace").decode() or "(empty)")
c.close()
