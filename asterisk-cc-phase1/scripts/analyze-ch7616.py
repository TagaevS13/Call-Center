#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
cmds = [
    "grep '\\[7616\\]\\[C-0000000a\\]' /var/log/asterisk/full | grep 'Sent RTP' | head -5",
    "grep '\\[7616\\]\\[C-0000000a\\]' /var/log/asterisk/full | grep 'Sent RTP' | wc -l",
    "grep '\\[7616\\]\\[C-0000000a\\]' /var/log/asterisk/full | grep -iE 'DTLS|ICE|SRTP|WARNING|ERROR' | head -25",
    "grep '1001-0000000d' /var/log/asterisk/full | grep -iE 'Sent RTP|Got  RTP|DTLS|ICE|Bridge' | head -30",
]
for cmd in cmds:
    full = f"cd /opt/call-center/asterisk-cc-phase1 && sh -c '{cmd}'"
    _, o, _ = c.exec_command(full, timeout=90)
    print(f"=== {cmd[:60]} ===")
    print(o.read().decode("utf-8", errors="replace")[:2500] or "(empty)\n")
c.close()
