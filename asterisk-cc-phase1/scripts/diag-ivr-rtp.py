#!/usr/bin/env python3
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
cmd = """cd /opt/call-center/asterisk-cc-phase1 && sh -c '
grep -E "Playback|1263|Got RTP|Sent RTP|10\\.1\\.5" /var/log/asterisk/full | tail -60
'
"""
_, o, _ = c.exec_command(cmd, timeout=90)
print(o.read().decode("utf-8", errors="replace")[:12000])
c.close()
