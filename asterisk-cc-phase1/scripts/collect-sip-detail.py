#!/usr/bin/env python3
from pathlib import Path

import paramiko

HOST, USER, PASS = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"
OUT = Path(__file__).resolve().parents[2] / "sip-detail-out.txt"

cmds = [
    "cat /etc/asterisk/pjsip_provider.conf",
    "asterisk -rx 'pjsip show endpoint provider'",
    "sh -c \"grep -a 'INVITE\\|200 OK\\|m=audio\\|c=IN IP4' /var/log/asterisk/full 2>/dev/null | tail -40\"",
    "sh -c \"grep -a 'Got  RTP' /var/log/asterisk/full 2>/dev/null | tail -20\"",
    "sh -c \"grep -a 'RTP packet' /var/log/asterisk/full 2>/dev/null | tail -20\"",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)
lines = []
for cmd in cmds:
    _, o, e = c.exec_command(f"cd {REMOTE}; {cmd}", timeout=120)
    out = (o.read() + e.read()).decode("utf-8", "replace")
    lines.append(f">>> {cmd[:90]}\n{out[-3500:]}\n{'=' * 40}\n")
c.close()
OUT.write_text("".join(lines), encoding="utf-8")
print(f"wrote {OUT}")
