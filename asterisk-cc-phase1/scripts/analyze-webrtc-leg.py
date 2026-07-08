#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
script = """
cd /opt/call-center/asterisk-cc-phase1
sh -c 'grep C-0000000a /var/log/asterisk/full | grep -iE "1001|49200|17878|dtls|ice completed|ice|srtp|rtcp" | grep -vi queue | head -50'
echo "==="
sh -c 'grep "05:51:0" /var/log/asterisk/full | grep -iE "7616|1001-0000000d" | grep -iE "Sent|Got|DTLS|ICE" | head -30'
"""
_, o, _ = c.exec_command(script, timeout=120)
print(o.read().decode("utf-8", errors="replace")[:8000])
c.close()
