#!/usr/bin/env python3
from pathlib import Path
import paramiko

HOST, USER, PASS = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)
cmd = (
    "sh -c "
    "'tail -c 4000000 /var/log/asterisk/full | grep -a \"Got  RTP packet from\" | tail -12'"
)
_, o, e = c.exec_command(f"cd {REMOTE}; {cmd}", timeout=180)
out = (o.read() + e.read()).decode("utf-8", "replace")
Path(r"C:/Users/ADMIN/CC/sip-detail-out.txt").write_text(out, encoding="utf-8")
print(out or "(empty)")
c.close()
