#!/usr/bin/env python3
from pathlib import Path

import paramiko

HOST, USER, PASS = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"
OUT = Path(__file__).resolve().parents[2] / "sip-detail-out.txt"

cmds = [
    "ls -la /var/log/asterisk/",
    'sh -c "wc -l /var/log/asterisk/full /var/log/asterisk/messages 2>/dev/null"',
    'sh -c "grep -a \"c=IN IP4\" /var/log/asterisk/messages 2>/dev/null | tail -25"',
    'sh -c "grep -a \"Got.RTP\" /var/log/asterisk/messages 2>/dev/null | tail -15"',
    'sh -c "grep -a \"10.1.5\" /var/log/asterisk/messages 2>/dev/null | tail -20"',
    "asterisk -rx 'core show channels'",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)
lines = []
for cmd in cmds:
    _, o, e = c.exec_command(f"cd {REMOTE}; {cmd}", timeout=120)
    out = (o.read() + e.read()).decode("utf-8", "replace")
    lines.append(f">>> {cmd}\n{out[-4000:]}\n{'=' * 40}\n")
c.close()
OUT.write_text("".join(lines), encoding="utf-8")
print(f"wrote {OUT}")
