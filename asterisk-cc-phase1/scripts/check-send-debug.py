#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
_, o, _ = c.exec_command(
    ""
    "sh -c 'grep \"2026-06-18 06:35\" /var/log/asterisk/full | grep \"\\[699\\]\" | grep C-00000001 | grep -iE \"sendto|__rtp_send|srtp protect|write\" | head -20'",
    timeout=60,
)
print(o.read().decode("utf-8", errors="replace") or "(no send debug lines)")
c.close()
