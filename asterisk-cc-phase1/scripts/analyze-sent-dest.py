#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
script = """
cd /opt/call-center/asterisk-cc-phase1
echo "=== Sent to 49200 (TURN) during C-0000000a ==="
sh -c 'grep C-0000000a /var/log/asterisk/full | grep "Sent RTP" | grep 49200 | wc -l'
sh -c 'grep C-0000000a /var/log/asterisk/full | grep "Sent RTP" | grep 49200 | head -3'

echo "=== Sent to 192.168 during C-0000000a ==="
sh -c 'grep C-0000000a /var/log/asterisk/full | grep "Sent RTP" | grep 192.168 | wc -l'

echo "=== Unique Sent destinations C-0000000a ==="
sh -c 'grep C-0000000a /var/log/asterisk/full | grep "Sent RTP packet to" | sed "s/.*to */to /" | awk -F"to " "{print \\$2}" | awk "{print \\$1}" | sort -u'

echo "=== Unique Got sources C-0000000a ==="
sh -c 'grep C-0000000a /var/log/asterisk/full | grep "Got  RTP packet from" | sed "s/.*from */from /" | awk -F"from " "{print \\$2}" | awk "{print \\$1}" | sort -u'

echo "=== Bridge / native_rtp ==="
sh -c 'grep C-0000000a /var/log/asterisk/full | grep -i bridge | head -10'
"""
_, o, _ = c.exec_command(script, timeout=120)
print(o.read().decode("utf-8", errors="replace"))
c.close()
