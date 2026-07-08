#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
_, o, _ = c.exec_command(
    ""
    "ls -la /var/spool/asterisk/recordings/2026/06/18/*4494* 2>/dev/null; "
    ""
    "sh -c 'grep \"2026-06-18 06:35\" /var/log/asterisk/full | grep C-00000001 | grep \"Got  RTP\" | grep 10.1.5 | wc -l'",
    timeout=60,
)
print(o.read().decode("utf-8", errors="replace"))
c.close()
