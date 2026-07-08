#!/usr/bin/env python3
import paramiko

HOST, USER, PASS = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)
for pat in ["Got  RTP", "192.168", "10.1.5", "channelstats", "BridgeId"]:
    cmd = (
        "sh -c "
        f"'tail -c 8000000 /var/log/asterisk/full | grep -a \"{pat}\" | tail -5'"
    )
    _, o, _ = c.exec_command(f"cd {REMOTE}; {cmd}", timeout=180)
    out = o.read().decode("utf-8", "replace").strip()
    print(f"=== {pat} ===\n{out or '(none)'}\n")
c.close()
