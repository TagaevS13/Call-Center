#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
script = """
cd /opt/call-center/asterisk-cc-phase1
sh -c 'grep "06:35:" /var/log/asterisk/full | grep CC-TRACE | tail -8'
echo "--- 16604 ---"
sh -c 'grep 16604 /var/log/asterisk/full | tail -15'
echo "--- recent C- id ---"
sh -c 'grep CC-TRACE /var/log/asterisk/full | tail -5'
CID=$(sh -c 'grep "06:35:" /var/log/asterisk/full | grep -oE "C-[0-9]+" | head -1' | tr -d '\\r')
echo CID=$CID
if [ -n "$CID" ]; then
  sh -c "grep $CID /var/log/asterisk/full | grep 'Got  RTP' | sed 's/.*from */from /' | awk '{{print \\$2}}' | sort -u"
  sh -c "grep $CID /var/log/asterisk/full | grep 'Sent RTP' | sed 's/.*to */to /' | awk '{{print \\$2}}' | sort -u"
  sh -c "grep $CID /var/log/asterisk/full | grep 'Sent RTP' | wc -l"
  sh -c "grep $CID /var/log/asterisk/full | grep 'Got  RTP' | wc -l"
fi
"""
_, o, _ = c.exec_command(script, timeout=120)
print(o.read().decode("utf-8", errors="replace"))
c.close()
