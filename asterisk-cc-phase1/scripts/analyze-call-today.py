#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
script = """
cd /opt/call-center/asterisk-cc-phase1
sh -c 'grep "2026-06-18 06:35" /var/log/asterisk/full | grep C-00000001 | grep "Got  RTP" | sed "s/.*from */from /" | awk "{print \\$2}" | sort | uniq -c'
echo "--- sent ---"
sh -c 'grep "2026-06-18 06:35" /var/log/asterisk/full | grep C-00000001 | grep "Sent RTP" | sed "s/.*to */to /" | awk "{print \\$2}" | sort | uniq -c'
echo "--- sent 192 ---"
sh -c 'grep "2026-06-18 06:35" /var/log/asterisk/full | grep C-00000001 | grep "Sent RTP" | grep 192.168 | wc -l'
echo "--- sent 50377 ---"
sh -c 'grep "2026-06-18 06:35" /var/log/asterisk/full | grep C-00000001 | grep "Sent RTP" | grep 50377 | wc -l'
echo "--- ch sent/got ---"
for id in 638 699 404 394 416; do
  g=$(sh -c "grep '2026-06-18 06:35' /var/log/asterisk/full | grep '\\[$id\\]' | grep C-00000001 | grep 'Got  RTP' | wc -l" | tr -d '\\r')
  s=$(sh -c "grep '2026-06-18 06:35' /var/log/asterisk/full | grep '\\[$id\\]' | grep C-00000001 | grep 'Sent RTP' | wc -l" | tr -d '\\r')
  if [ "$g" != "0" ] || [ "$s" != "0" ]; then echo "tid $id got=$g sent=$s"; fi
done
"""
_, o, _ = c.exec_command(script, timeout=120)
print(o.read().decode("utf-8", errors="replace"))
c.close()
