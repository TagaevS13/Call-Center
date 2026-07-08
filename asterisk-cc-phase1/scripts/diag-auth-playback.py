#!/usr/bin/env python3
import paramiko, json

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password="qwerty123", timeout=30)
cmds = [
    """curl -s -X POST http://127.0.0.1:9000/api/auth/login -H 'Content-Type: application/json' -d '{"login":"admin","password":"admin"}'""",
    """curl -s -X POST http://127.0.0.1:9000/api/auth/login -H 'Content-Type: application/json' -d '{"login":"supervisor","password":"supervisor"}'""",
    """curl -s -X POST http://127.0.0.1:9000/api/auth/login -H 'Content-Type: application/json' -d '{"login":"agent01","password":"agent01"}'""",
    "cd /opt/call-center/asterisk-cc-phase1 && sh -c 'grep -E \"Playback|custom/101|WARNING|ERROR|2674|2607\" /var/log/asterisk/full | grep -A2 -B2 \"05:09:0\" | tail -40'",
    "cd /opt/call-center/asterisk-cc-phase1 && asterisk -rx 'core show file custom/101'",
    "ls -la /opt/call-center/asterisk-cc-phase1/asterisk/sounds/custom/",
    "grep -A10 'vdn-1263-direct' /opt/call-center/asterisk-cc-phase1/asterisk/etc/vdn_generated.conf",
]
for cmd in cmds:
    print("\n===", cmd[:100], "===\n")
    _, o, e = c.exec_command(cmd, timeout=60)
    print(o.read().decode('utf-8', errors='replace')[:5000])
c.close()
