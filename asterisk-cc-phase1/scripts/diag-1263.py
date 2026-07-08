#!/usr/bin/env python3
import paramiko

HOST, USER, PASSWORD = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

cmds = [
    f"grep -n 1263 {REMOTE}/asterisk/etc/vdn_generated.conf | head -20",
    f"awk '/1263/,/^$/' {REMOTE}/asterisk/etc/vdn_generated.conf | head -50",
    f"cd {REMOTE} && asterisk -rx 'dialplan show vdn-route' 2>&1 | grep -A8 1263",
    f"cd {REMOTE} && asterisk -rx 'dialplan show vdn-1263-ivr' 2>&1 | head -35",
    f"cd {REMOTE} && file /var/lib/asterisk/sounds/custom/101.wav",
    f"cd {REMOTE} && ls -la /var/lib/asterisk/sounds/custom/",
    f"cd {REMOTE} && asterisk -rx 'core show translation' 2>&1 | head -5",
    f"tail -200 /var/log/asterisk/full 2>/dev/null | grep 1263 | tail -30",
    f"cd {REMOTE} && tail -150 /var/log/asterisk/full 2>&1 | grep -E '1263|custom/101|vdn-1263|IVR_DIGIT|blacklist|Hangup' | tail -40",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=30)
for cmd in cmds:
    print("\n===", cmd[:120], "===\n", flush=True)
    _, stdout, stderr = c.exec_command(cmd, timeout=90)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out:
        print(out[:6000])
    if err.strip():
        print("stderr:", err[:1500])
c.close()
