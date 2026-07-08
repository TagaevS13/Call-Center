#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
script = """
cd /opt/call-center/asterisk-cc-phase1
echo "7616 sent count:"
sh -c 'grep "\\[7616\\]" /var/log/asterisk/full | grep C-0000000a | grep "Sent RTP" | wc -l'
echo "7561 sent count:"
sh -c 'grep "\\[7561\\]" /var/log/asterisk/full | grep C-0000000a | grep "Sent RTP" | wc -l'
echo "7616 got count:"
sh -c 'grep "\\[7616\\]" /var/log/asterisk/full | grep C-0000000a | grep "Got  RTP" | wc -l'
echo "7561 got count:"
sh -c 'grep "\\[7561\\]" /var/log/asterisk/full | grep C-0000000a | grep "Got  RTP" | wc -l'
echo "provider got 10.1.5:"
sh -c 'grep "\\[7561\\]" /var/log/asterisk/full | grep C-0000000a | grep "Got  RTP" | grep 10.1.5 | wc -l'
echo "ICE remote after bridge:"
sh -c 'grep C-0000000a /var/log/asterisk/full | grep -i "ICE.*remote\\|selected\\|49200\\|17878" | head -20'
"""
_, o, _ = c.exec_command(script, timeout=120)
print(o.read().decode("utf-8", errors="replace"))
c.close()
