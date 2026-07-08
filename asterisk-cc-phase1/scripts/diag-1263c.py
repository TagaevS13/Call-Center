#!/usr/bin/env python3
import paramiko

HOST, USER, PASSWORD = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

cmds = [
    f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c \"SELECT number, name, route_type, enabled FROM vdn_routes ORDER BY number;\"",
    f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c \"SELECT aq.queue_name, a.sip_user, a.full_name, aq.penalty FROM agent_queue aq JOIN agents a ON a.id=aq.agent_id ORDER BY 1;\"",
    f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c \"SELECT msisdn, blocked, vip, block_reason FROM subscribers_access LIMIT 20;\" 2>&1",
    f"cd {REMOTE} && grep -E '1263|QUEUESTATUS|queue-enter|vdn-1263|JOINEMPTY|LEAVEEMPTY|russkaya' /var/log/asterisk/cc_calls.log 2>/dev/null | tail -40",
    f"cd {REMOTE} && tail -500 /var/log/asterisk/messages 2>&1 | grep -E '1263|INBOUND|vdn-1263|Queue|russkaya|Hangup' | tail -50",
    f"grep -n 'member =>' {REMOTE}/asterisk/etc/queues_generated.conf | head -20",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
for cmd in cmds:
    print("\n===", cmd[:140], "===\n", flush=True)
    _, stdout, _ = c.exec_command(cmd, timeout=90)
    print(stdout.read().decode("utf-8", errors="replace")[:8000])
c.close()
