#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
script = """
cd /opt/call-center/asterisk-cc-phase1
sh -c 'grep "2026-06-18 06:35" /var/log/asterisk/full | grep "\\[699\\]" | grep C-00000001 | grep -iE "DTLS|ICE|write|send|mute|SRTP|established|valid pair" | head -40'
echo "---"
sh -c 'grep "2026-06-18 06:35" /var/log/asterisk/full | grep 1001-00000001 | grep -iE "answered|Bridge|DTLS|ICE" | head -20'
"""
_, o, _ = c.exec_command(script, timeout=90)
print(o.read().decode("utf-8", errors="replace"))
c.close()
