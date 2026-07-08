#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
script = """
cd /opt/call-center/asterisk-cc-phase1
sh -c 'grep "\\[7616\\]" /var/log/asterisk/full | grep C-0000000a | grep -iE "send|write|srtp protect|__rtp_send" | head -25'
echo "---"
sh -c 'grep C-0000000a /var/log/asterisk/full | grep -iE "srtp protect|Sent RTP" | grep 7616 | head -10'
echo "--- recording size ---"
sh -c 'ls -la /var/spool/asterisk/recordings/2026/06/18/*1845* 2>/dev/null; wc -c /var/spool/asterisk/recordings/2026/06/18/*1845* 2>/dev/null'
"""
_, o, _ = c.exec_command(script, timeout=90)
print(o.read().decode("utf-8", errors="replace"))
c.close()
