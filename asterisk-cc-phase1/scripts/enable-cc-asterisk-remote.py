#!/usr/bin/env python3
import os, paramiko
from scp import SCPClient
PASSWORD = "qwerty123"
REMOTE = "/opt/call-center/asterisk-cc-phase1"
LOCAL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("172.16.6.183", username="sorbon", password=PASSWORD, timeout=30)
sudo = f"echo '{PASSWORD}' | sudo -S"
units = [
    "ops/systemd/native/cc-asterisk.service",
    "ops/systemd/native/cc-reload-watcher.service",
    "ops/systemd/native/cc-asterisk-exporter.service",
    "ops/systemd/native/cc-asterisk-prestart.service",
]
with SCPClient(c.get_transport()) as scp:
    for u in units:
        scp.put(os.path.join(LOCAL, u.replace("/", os.sep)), f"{REMOTE}/{u}")
cmds = [
    f"for u in cc-asterisk cc-reload-watcher cc-asterisk-exporter cc-asterisk-prestart; do {sudo} cp {REMOTE}/ops/systemd/native/$u.service /etc/systemd/system/; done",
    f"{sudo} systemctl disable asterisk || true",
    f"{sudo} systemctl daemon-reload",
    f"{sudo} systemctl enable cc-asterisk cc-reload-watcher cc-asterisk-exporter cc-ami-listener",
    f"{sudo} systemctl restart cc-asterisk-prestart cc-asterisk cc-reload-watcher cc-asterisk-exporter cc-ami-listener",
    "sleep 5",
    "systemctl is-active cc-asterisk cc-reload-watcher cc-asterisk-exporter cc-webui cc-coturn grafana-server prometheus postgresql",
    f"{sudo} asterisk -rx 'core show version' | head -1",
]
for cmd in cmds:
    print("\n>>>", cmd[:100])
    _, o, _ = c.exec_command(cmd, timeout=120)
    print(o.read().decode().encode("ascii", errors="replace").decode()[:2500])
c.close()
