#!/usr/bin/env python3
import paramiko

HOST, USER, PASS = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

cmds = [
    "ls -la /var/log/asterisk/full 2>&1 | head -3",
    "tail -3 /var/log/asterisk/full 2>&1",
    "grep -a 'Got  RTP packet from' /var/log/asterisk/full 2>/dev/null | tail -20",
    "grep -a 'Got  RTP packet from' /var/log/asterisk/full 2>/dev/null | grep 10.1.5 | tail -15",
    "grep -a 'c=IN IP4 172' /var/log/asterisk/full 2>/dev/null | tail -12",
    "grep -a 'Channel.*provider' /var/log/asterisk/full 2>/dev/null | tail -5",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)
for cmd in cmds:
    print(">>>", cmd)
    _, o, e = c.exec_command(f"cd {REMOTE}; {cmd}", timeout=90)
    print((o.read() + e.read()).decode("utf-8", "replace")[-2500:])
    print("---")
c.close()
