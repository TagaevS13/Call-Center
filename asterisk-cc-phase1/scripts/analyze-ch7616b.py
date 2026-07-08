#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
script = r"""
cd /opt/call-center/asterisk-cc-phase1
sh -c 'grep 7616 /var/log/asterisk/full | grep C-0000000a | grep "Sent RTP" | wc -l'
echo "--- sent sample ---"
sh -c 'grep 7616 /var/log/asterisk/full | grep C-0000000a | grep "Sent RTP" | head -3'
echo "--- dtls ice ---"
sh -c 'grep 1001-0000000d /var/log/asterisk/full | grep -iE "DTLS|ICE|SRTP|WARNING|ERROR|Sent RTP|Got  RTP" | head -40'
echo "--- provider got gsm ---"
sh -c 'grep 7561 /var/log/asterisk/full | grep C-0000000a | grep "Got  RTP" | grep 10.1.5 | wc -l'
"""
_, o, _ = c.exec_command(script, timeout=120)
print(o.read().decode("utf-8", errors="replace"))
c.close()
