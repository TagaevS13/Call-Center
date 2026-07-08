#!/usr/bin/env python3
import paramiko

HOST, USER, PASSWORD = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

cmds = [
    f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c \"SELECT id, sip_user, full_name, enabled FROM agents;\"",
    f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c \"\\d agent_queue\"",
    f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c \"SELECT * FROM agent_queue;\"",
    f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c \"SELECT calldate, src, dst, disposition, lastapp, lastdata, duration, billsec FROM cdr WHERE dst LIKE '%1263%' ORDER BY calldate DESC LIMIT 15;\"",
    f"cd {REMOTE} && psql -h 127.0.0.1 -p 5433 -U postgres -U postgres -d asterisk_cc -c \"SELECT eventtime, eventtype, cid_num, exten, context, appname, appdata FROM cel WHERE exten IN ('1263','s','russkaya') OR appdata LIKE '%1263%' ORDER BY eventtime DESC LIMIT 25;\"",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
for cmd in cmds:
    print("\n===", cmd[:130], "===\n", flush=True)
    _, stdout, stderr = c.exec_command(cmd, timeout=90)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    print(out[:8000])
    if err.strip():
        print("ERR:", err[:500])
c.close()
