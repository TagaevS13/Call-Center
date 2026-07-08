#!/usr/bin/env python3
import paramiko

HOST, USER, PASS = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"
cmd = (
    "sh -c "
    "\"grep -a '2026-06-17 11:46:10' /var/log/asterisk/full | head -5; "
    "grep -aA80 '2026-06-17 11:46:10.721.*Received SIP request' /var/log/asterisk/full | head -85\""
)
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)
_, o, _ = c.exec_command(f"cd {REMOTE}; {cmd}", timeout=120)
text = o.read().decode("utf-8", "replace")
Path = __import__("pathlib").Path
Path(r"C:/Users/ADMIN/CC/invite-1146.txt").write_text(text, encoding="utf-8")
print(text[-4000:])
c.close()
