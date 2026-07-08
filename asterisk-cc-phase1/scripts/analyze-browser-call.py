#!/usr/bin/env python3
import paramiko
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
CALL_ID = "e4883707"
script = f"""
cd /opt/call-center/asterisk-cc-phase1
echo "=== CC-TRACE for call ==="
sh -c 'grep {CALL_ID} /var/log/asterisk/full | grep CC-TRACE | tail -5'
echo "=== find C- id ==="
sh -c 'grep {CALL_ID} /var/log/asterisk/full | grep C-000000 | head -3'
CID=$(sh -c 'grep {CALL_ID} /var/log/asterisk/full | grep -oE "C-[0-9]+" | head -1' | tr -d '\\r')
echo "CID=$CID"
if [ -n "$CID" ]; then
  sh -c "grep $CID /var/log/asterisk/full | grep 'Got  RTP' | sed 's/.*from */from /' | awk -Ffrom '{{print \\$2}}' | awk '{{print \\$1}}' | sort -u"
  echo "--- sent unique ---"
  sh -c "grep $CID /var/log/asterisk/full | grep 'Sent RTP' | sed 's/.*to */to /' | awk -Fto '{{print \\$2}}' | awk '{{print \\$1}}' | sort -u"
  echo "--- per channel got/sent ---"
  for ch in 7561 7616 7620 7700 7800; do
    g=$(sh -c "grep \\\"[$ch]\\\" /var/log/asterisk/full | grep $CID | grep 'Got  RTP' | wc -l" | tr -d '\\r')
    s=$(sh -c "grep \\\"[$ch]\\\" /var/log/asterisk/full | grep $CID | grep 'Sent RTP' | wc -l" | tr -d '\\r')
    if [ "$g" != "0" ] || [ "$s" != "0" ]; then echo "ch $ch got=$g sent=$s"; fi
  done
  sh -c "grep $CID /var/log/asterisk/full | grep 'Got  RTP' | wc -l"
  sh -c "grep $CID /var/log/asterisk/full | grep 'Sent RTP' | wc -l"
  sh -c "grep $CID /var/log/asterisk/full | grep 16604 | head -5"
fi
"""
_, o, _ = c.exec_command(script, timeout=120)
print(o.read().decode("utf-8", errors="replace"))
c.close()
