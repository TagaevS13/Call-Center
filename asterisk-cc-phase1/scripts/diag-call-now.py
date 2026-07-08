#!/usr/bin/env python3
import paramiko

HOST, USER, PASSWORD = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

cmds = [
    f"cd {REMOTE} && asterisk -rx 'pjsip show endpoint 1001'",
    f"cd {REMOTE} && asterisk -rx 'queue show russkaya'",
    f"cd {REMOTE} && asterisk -rx 'core show channels'",
    f"grep -A14 '\\[vdn-1263-direct\\]' {REMOTE}/asterisk/etc/vdn_generated.conf",
    f"grep -A5 '\\[russkaya\\]' {REMOTE}/asterisk/etc/queues_generated.conf | head -8",
    f"cd {REMOTE} && sh -c 'grep CC-TRACE /var/log/asterisk/full 2>/dev/null | tail -25'",
    f"cd {REMOTE} && sh -c 'grep -E \"1263|Playback|QUEUE|LEAVEEMPTY|exited non-zero|Hangup\" /var/log/asterisk/full 2>/dev/null | tail -40'",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
for cmd in cmds:
    print("\n=== CMD ===\n", cmd[:140], flush=True)
    _, stdout, stderr = c.exec_command(cmd, timeout=90)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    # safe print for Windows console
    try:
        print(out[:10000])
    except UnicodeEncodeError:
        print(out.encode("ascii", errors="replace").decode("ascii")[:10000])
    if err.strip():
        print("ERR:", err[:500])
c.close()
