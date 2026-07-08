#!/usr/bin/env python3
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
cmds = [
    "grep -A6 '\\[russkaya\\]' /opt/call-center/asterisk-cc-phase1/asterisk/etc/queues_generated.conf | head -10",
    "cd /opt/call-center/asterisk-cc-phase1 && asterisk -rx 'queue show russkaya'",
    "grep -A12 'vdn-1263-direct' /opt/call-center/asterisk-cc-phase1/asterisk/etc/vdn_generated.conf | head -15",
]
for cmd in cmds:
    print("===", cmd)
    _, o, _ = c.exec_command(cmd, timeout=60)
    print(o.read().decode())
c.close()
