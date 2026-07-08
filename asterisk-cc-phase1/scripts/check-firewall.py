#!/usr/bin/env python3
import paramiko

HOST, USER, PASS = "172.16.6.183", "sorbon", "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"

cmds = [
    "sudo iptables -L INPUT -n -v 2>/dev/null | head -25 || echo no-iptables",
    "sudo nft list ruleset 2>/dev/null | head -30 || echo no-nft",
    "sudo ufw status 2>/dev/null || echo no-ufw",
    "ss -ulnp | grep -E '12428|asterisk' | head -10",
]

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASS, timeout=30)
for cmd in cmds:
    _, o, e = c.exec_command(f"echo qwerty123 | sudo -S bash -c '{cmd}'", timeout=60)
    print(">>>", cmd)
    print((o.read() + e.read()).decode("utf-8", "replace")[:2000])
    print("---")
c.close()
