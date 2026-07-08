#!/usr/bin/env python3
from pathlib import Path
import paramiko

HOST, USER, PASS = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"
OUT = Path(__file__).resolve().parents[2] / "call-evidence.txt"

cmds = [
    # call around 11:46
    "sh -c \"grep -a '2026-06-17 11:46' /var/log/asterisk/full | grep -aE 'c=IN IP4|m=audio|10.1.5|172.16' | head -40\"",
    "sh -c \"grep -a '2026-06-17 11:46' /var/log/asterisk/full | grep -a 'Sent  RTP' | tail -15\"",
    "sh -c \"grep -a '2026-06-17 11:46' /var/log/asterisk/full | grep -a 'Got  RTP' | tail -15\"",
    "sh -c \"grep -a '2026-06-17 11:46' /var/log/asterisk/full | grep -a 'Transmitting SIP response' | tail -5\"",
    "sh -c \"grep -a '2026-06-17 11:46' /var/log/asterisk/full | grep -aA30 'Transmitting SIP response' | grep -aE 'c=IN IP4|m=audio|o=|s=' | head -20\"",
    "sh -c \"grep -a '2026-06-17 11:46' /var/log/asterisk/full | grep -ai precondition | head -10\"",
    "sh -c \"grep -a '2026-06-17 11:46' /var/log/asterisk/full | grep -a 'provider' | head -15\"",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)
parts = []
for cmd in cmds:
    _, o, _ = c.exec_command(f"cd {REMOTE}; {cmd}", timeout=120)
    out = o.read().decode("utf-8", "replace")
    parts.append(f">>> {cmd}\n{out}\n{'='*50}\n")
c.close()
OUT.write_text("".join(parts), encoding="utf-8")
print(f"wrote {OUT}")
