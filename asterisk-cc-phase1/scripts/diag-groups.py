#!/usr/bin/env python3
import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
cmd = """cd /opt/call-center/asterisk-cc-phase1 && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c "
SELECT a.sip_user, ag.group_id FROM agents a
LEFT JOIN agent_groups ag ON ag.agent_id=a.id
WHERE a.sip_user IN ('1001','1002');
SELECT group_id, queue FROM group_queues WHERE group_id LIKE 'skill_%' LIMIT 15;
"
"""
_, o, _ = c.exec_command(cmd, timeout=60)
print(o.read().decode())
c.close()
