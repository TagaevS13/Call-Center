#!/usr/bin/env python3
import paramiko

HOST, USER, PASS = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)
cmd = (
    "sh -c "
    "'tail -c 12000000 /var/log/asterisk/full | grep -aA25 \"Transmitting SIP response\" | "
    "grep -aE \"c=IN IP4|m=audio|10.1.5.10|172.16\" | tail -40'"
)
_, o, _ = c.exec_command(f"cd {REMOTE}; {cmd}", timeout=180)
print(o.read().decode("utf-8", "replace"))
c.close()
